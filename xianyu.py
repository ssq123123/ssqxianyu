import requests
import time
import hashlib
import threading
import queue
import json
import os
import sys

# 解决中文路径问题和Qt平台插件问题
os.environ['QTWEBENGINE_CHROMIUM_FLAGS'] = '--disable-gpu'
os.environ['QTWEBENGINE_LOCALES_PATH'] = os.path.join(os.path.dirname(sys.executable), 'Lib', 'site-packages', 'PyQt5', 'Qt5', 'translations')
os.environ['QT_QPA_PLATFORM_PLUGIN_PATH'] = os.path.join(os.path.dirname(sys.executable), 'Lib', 'site-packages', 'PyQt5', 'Qt5', 'plugins')

# 设置QtWebEngineProcess路径
qt_webengine_path = os.path.join(os.path.dirname(sys.executable), 'Lib', 'site-packages', 'PyQt5', 'Qt5', 'bin')
qt_webengine_process = os.path.join(qt_webengine_path, 'QtWebEngineProcess.exe')
if 'QTWEBENGINEPROCESS_PATH' not in os.environ and os.path.exists(qt_webengine_process):
    os.environ['QTWEBENGINEPROCESS_PATH'] = qt_webengine_process

from openpyxl import Workbook
from openpyxl.drawing.image import Image
from openpyxl.utils import get_column_letter
from datetime import datetime
import webbrowser
import sys

# 导入PyQt5模块
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, 
                             QPushButton, QTextEdit, QGroupBox, QGridLayout, QComboBox, QMessageBox, QProgressBar,
                             QFileDialog, QScrollArea, QSizePolicy, QSpacerItem, QDialog)
from PyQt5.QtCore import Qt, QThread, pyqtSignal, QUrl
from PyQt5.QtGui import QTextCursor
from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineProfile
from PyQt5.QtNetwork import QNetworkCookie

# 常量配置
API_URL = "https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/"
APP_KEY = "34839810"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0"
REQUEST_DELAY = 1.5  # 请求间隔时间（秒）
COOKIE_FILE = "xianyu_cookie.json"  # Cookie存储文件
MAX_WORKERS = 5  # 最大工作线程数
IMAGE_FOLDER = "xianyu_images"  # 图片保存文件夹
SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'bmp']  # 支持的图片格式

class WorkerThread(QThread):
    """工作线程类"""
    log_signal = pyqtSignal(str)
    progress_signal = pyqtSignal(int, int)  # (当前页, 总页数)
    status_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(list, list)  # (结果列表, 失败页列表)
    
    def __init__(self, spider, keyword, pages, workers, min_price, max_price):
        super().__init__()
        self.spider = spider
        self.keyword = keyword
        self.pages = pages
        self.workers = workers
        self.min_price = min_price
        self.max_price = max_price
        self.is_running = True
        
    def run(self):
        """线程运行方法"""
        try:
            # 创建任务队列
            task_queue = queue.Queue()
            for page in range(1, self.pages + 1):
                task_queue.put(page)

            # 创建结果列表
            results = []
            failed_pages = []
            
            # 工作线程列表
            threads = []
            
            # 创建并启动工作线程
            for i in range(self.workers):
                thread = threading.Thread(
                    target=self.worker_task, 
                    args=(self.keyword, task_queue, results, failed_pages),
                    daemon=True
                )
                thread.start()
                threads.append(thread)
                self.log_signal.emit(f"启动工作线程 #{i + 1}")
            
            # 等待所有任务完成
            task_queue.join()
            
            # 等待所有工作线程结束
            for thread in threads:
                if thread.is_alive():
                    thread.join(timeout=1.0)
            
            # 发送完成信号
            self.finished_signal.emit(results, failed_pages)
            
        except Exception as e:
            self.log_signal.emit(f"❌ 工作线程错误: {str(e)}")
    
    def worker_task(self, keyword, task_queue, results, failed_pages):
        """工作线程任务"""
        while self.is_running and not task_queue.empty():
            try:
                page = task_queue.get()
                self.log_signal.emit(f"开始爬取第 {page} 页")
                self.progress_signal.emit(page, self.pages)

                # 发送请求
                products = self.spider.fetch_products(keyword, page)

                if products is None:
                    failed_pages.append(page)
                    self.log_signal.emit(f"⚠️ 第 {page} 页爬取失败")
                elif products == "TOKEN_EXPIRED":
                    failed_pages.append(page)
                    self.log_signal.emit("❌ Token已过期，请重新登录获取Cookie")
                    self.is_running = False
                else:
                    # 解析商品
                    for product in products:
                        parsed = self.spider.parse_product(product)
                        if parsed:
                            # 价格过滤
                            try:
                                price = float(parsed["price"])
                                if (self.min_price is None or price >= self.min_price) and \
                                   (self.max_price is None or price <= self.max_price):
                                    results.append(parsed)
                            except (ValueError, TypeError):
                                # 如果价格无法转换为数字，保留该商品
                                results.append(parsed)

                    self.log_signal.emit(f"✅ 第 {page} 页完成, 获取 {len(products)} 条商品")

                # 任务完成
                task_queue.task_done()

                # 请求间隔
                time.sleep(REQUEST_DELAY)

            except queue.Empty:
                break
            except Exception as e:
                self.log_signal.emit(f"⚠️ 线程错误: {str(e)}")
    
    def stop(self):
        """停止线程"""
        self.is_running = False
        self.log_signal.emit("⏹ 正在停止爬取...")

class SaveResultsThread(QThread):
    """保存结果线程类"""
    log_signal = pyqtSignal(str)
    progress_signal = pyqtSignal(int, int)  # (当前项, 总项数)
    finished_signal = pyqtSignal(str)  # 保存完成的文件名
    
    def __init__(self, spider, keyword, results):
        super().__init__()
        self.spider = spider
        self.keyword = keyword
        self.results = results
        self.is_running = True
    
    def run(self):
        """线程运行方法"""
        try:
            self.log_signal.emit("开始保存结果到Excel...")
            
            # 创建Excel工作簿和工作表
            wb = Workbook()
            ws = wb.active
            # 添加表头（包含图片列）
            ws.append(["用户名字", "简介", "链接", "价格", "地区", "图片"])

            # 调整列宽
            ws.column_dimensions["A"].width = 15  # 用户名
            ws.column_dimensions["B"].width = 40  # 简介
            ws.column_dimensions["C"].width = 30  # 链接
            ws.column_dimensions["F"].width = 20  # 图片列
            
            total_items = len(self.results)
            
            # 写入数据并处理图片
            for row_idx, data in enumerate(self.results, start=2):  # 从第2行开始（跳过表头）
                if not self.is_running:
                    self.log_signal.emit("保存过程已取消")
                    return
                
                # 更新进度
                self.progress_signal.emit(row_idx - 1, total_items)
                
                # 写入文字信息
                ws.cell(row=row_idx, column=1, value=data["user_name"])
                ws.cell(row=row_idx, column=2, value=data["description"])
                ws.cell(row=row_idx, column=3, value=data["url"])
                ws.cell(row=row_idx, column=4, value=data["price"])
                ws.cell(row=row_idx, column=5, value=data["area"])

                # 下载并插入图片
                pic_path = self.spider.download_image(data["pic_url"], data["item_id"])
                if pic_path and os.path.exists(pic_path):
                    try:
                        # 插入图片
                        img = Image(pic_path)
                        # 调整图片大小
                        img.width = 100
                        img.height = 100
                        # 插入到F列当前行
                        ws.add_image(img, anchor=f"F{row_idx}")
                        # 调整行高以适应图片
                        ws.row_dimensions[row_idx].height = 80
                        self.log_signal.emit(f"✅ 已插入图片: {os.path.basename(pic_path)}")
                    except Exception as e:
                        self.log_signal.emit(f"⚠️ 图片插入失败: {str(e)}")
                else:
                    self.log_signal.emit(f"⚠️ 图片下载失败: {data['pic_url']}")

            # 生成文件名
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{self.keyword}_{timestamp}.xlsx"
            wb.save(filename)
            
            self.log_signal.emit(f"✅ Excel文件保存成功: {filename}")
            self.finished_signal.emit(filename)
            
        except Exception as e:
            self.log_signal.emit(f"❌ 保存Excel文件失败: {str(e)}")
            self.finished_signal.emit("")
    
    def stop(self):
        """停止线程"""
        self.is_running = False
        self.log_signal.emit("⏹ 正在停止保存过程...")

class XianyuSpider:
    """闲鱼爬虫核心类"""
    def __init__(self):
        self.cookie = ""
        self.token = ""
        
        # 确保图片文件夹存在
        if not os.path.exists(IMAGE_FOLDER):
            os.makedirs(IMAGE_FOLDER)
        
        # 加载保存的Cookie
        self.load_cookie()
    
    def load_cookie(self):
        """从文件加载Cookie"""
        try:
            if os.path.exists(COOKIE_FILE):
                with open(COOKIE_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.cookie = data.get('cookie', '')
        except Exception as e:
            print(f"加载Cookie失败: {e}")
    
    def save_cookie(self, cookie):
        """保存Cookie到文件"""
        self.cookie = cookie
        if not self.cookie:
            return False

        try:
            with open(COOKIE_FILE, 'w', encoding='utf-8') as f:
                json.dump({'cookie': self.cookie}, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"保存Cookie失败: {e}")
            return False
    
    def extract_token(self, cookie):
        """从cookie中提取token"""
        if not cookie:
            return None

        try:
            # 查找_m_h5_tk在cookie中的位置
            if "_m_h5_tk=" not in cookie:
                return None

            start_idx = cookie.find("_m_h5_tk=") + len("_m_h5_tk=")
            end_idx = cookie.find(";", start_idx)
            if end_idx == -1:
                end_idx = len(cookie)

            m_h5_tk_value = cookie[start_idx:end_idx]
            token = m_h5_tk_value.split('_')[0]
            return token
        except Exception as e:
            print(f"提取Token失败: {e}")
            return None
    
    def fetch_products(self, keyword, page):
        """获取商品数据"""
        try:
            # 提取token
            token = self.extract_token(self.cookie)
            if not token:
                return None

            # 生成签名和请求参数
            sign, timestamp, request_data = self.generate_sign(page, keyword, token)

            # 构建请求头
            headers = {
                "cookie": self.cookie,
                "origin": "https://www.goofish.com",
                "referer": "https://www.goofish.com/",
                "user-agent": USER_AGENT
            }

            # 构建请求参数
            params = {
                "jsv": "2.7.2",
                "appKey": APP_KEY,
                "t": timestamp,
                "sign": sign,
                "v": "1.0",
                "type": "originaljson",
                "accountSite": "xianyu",
                "dataType": "json",
                "timeout": "20000",
                "api": "mtop.taobao.idlemtopsearch.pc.search",
                "sessionOption": "AutoLoginOnly",
                "spm_cnt": "a21ybx.search.0.0",
                "spm_pre": "a21ybx.home.searchSuggest.1.4c053da64Wswaf",
                "log_id": "4c053da64Wswaf"
            }

            # 发送POST请求
            response = requests.post(
                url=API_URL,
                headers=headers,
                params=params,
                data={"data": request_data},
                timeout=15
            )

            # 检查响应状态
            response.raise_for_status()

            # 检查是否Token失效
            result = response.json()
            if "ret" in result and "FAIL_SYS_TOKEN_EXOIRED" in result["ret"][0]:
                return "TOKEN_EXPIRED"

            # 检查返回数据是否包含商品列表
            if "data" in result and "resultList" in result["data"]:
                return result["data"]["resultList"]
            else:
                return None

        except requests.exceptions.RequestException as e:
            print(f"第{page}页请求失败: {str(e)}")
            return None
        except Exception as e:
            print(f"第{page}页数据处理错误: {str(e)}")
            return None
    
    def generate_sign(self, page, keyword, token):
        """生成签名"""
        # 生成当前时间戳（毫秒级）
        timestamp = int(time.time() * 1000)

        # 构建请求数据
        request_data = (
            f'{{"pageNumber":{page},"keyword":"{keyword}","fromFilter":false,'
            f'"rowsPerPage":30,"sortValue":"","sortField":"","customDistance":"",'
            f'"gps":"","propValueStr":"","customGps":"","searchReqFromPage":"pcSearch",'
            f'"extraFilterValue":"","userPositionJson":""}}'
        )

        # 构建签名原始字符串
        sign_str = f"{token}&{timestamp}&{APP_KEY}&{request_data}"

        # 计算MD5签名
        md5 = hashlib.md5()
        md5.update(sign_str.encode("utf-8"))
        sign = md5.hexdigest()

        return sign, timestamp, request_data
    
    def parse_product(self, product):
        """解析商品数据（包含图片URL提取）"""
        try:
            # 从原始数据中提取核心字段
            item_data = product["data"]["item"]["main"]["exContent"]
            click_params = product["data"]["item"]["main"]["clickParam"]["args"]

            # 提取图片URL
            pic_url = item_data.get("picUrl", "")
            if not pic_url:
                pic_url = click_params.get("picUrl", "无图片链接")

            # 提取用户昵称
            user_name = item_data.get("userNick", "未知用户").strip()

            # 提取标题和包邮信息
            title = item_data.get("title", "").strip()
            post_fee = click_params.get("tagname", "不包邮")
            description = f"{post_fee} +++ {title}"

            # 提取商品链接
            item_id = item_data.get("itemId", "")
            product_url = f"https://www.goofish.com/item?id={item_id}"

            # 提取价格和地区
            price = click_params.get("price", "未知")
            area = item_data.get("area", "未知地区").strip()

            return {
                "user_name": user_name,
                "description": description,
                "url": product_url,
                "price": price,
                "area": area,
                "pic_url": pic_url,  # 图片URL字段
                "item_id": item_id  # 商品ID用于图片命名
            }

        except Exception as e:
            print(f"商品数据解析异常: {str(e)}")
            return None
    
    def download_image(self, pic_url, item_id):
        """下载图片到本地，支持格式过滤和转换"""
        try:
            # 1. 跳过无图片链接的情况
            if pic_url == "无图片链接":
                return None

            # 2. 处理URL中的特殊字符，补全协议头
            if not pic_url.startswith(('http://', 'https://')):
                pic_url = f"http:{pic_url}" if pic_url.startswith('//') else f"https://{pic_url}"
            
            # 添加Referer头避免403错误
            referer_url = "https://www.goofish.com"

            # 3. 提取并验证文件后缀
            file_ext = pic_url.split(".")[-1].split("?")[0].lower()

            # 处理不支持的格式（如.mpo）
            if file_ext not in SUPPORTED_IMAGE_FORMATS:
                file_ext = "jpg"  # 强制使用支持的格式

            # 4. 图片文件名：用item_id避免重复
            file_name = f"{IMAGE_FOLDER}/{item_id}.{file_ext}"

            # 已下载则直接返回路径
            if os.path.exists(file_name):
                return file_name

            # 5. 发送请求下载图片 - 添加Cookie和Referer
            headers = {
                "User-Agent": USER_AGENT,
                "Cookie": self.cookie,  # 添加Cookie
                "Referer": referer_url  # 添加Referer
            }
            
            # 设置超时和重试
            session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(max_retries=3)
            session.mount('https://', adapter)
            
            response = session.get(pic_url, headers=headers, timeout=15)
            response.raise_for_status()

            # 6. 保存图片到本地
            with open(file_name, "wb") as f:
                f.write(response.content)

            # 7. 尝试转换特殊格式图片为jpg
            if file_ext in ['mpo', 'webp'] or file_ext not in SUPPORTED_IMAGE_FORMATS:
                try:
                    from PIL import Image as PILImage
                    # 打开图片并转换为RGB模式（兼容jpg）
                    img = PILImage.open(file_name)
                    
                    # 处理RGBA格式（透明背景）
                    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                        # 创建白色背景
                        background = PILImage.new('RGB', img.size, (255, 255, 255))
                        background.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)
                        img = background
                    else:
                        img = img.convert('RGB')
                    
                    # 覆盖保存为jpg
                    img.save(file_name, "JPEG", quality=90)
                    file_name = file_name.replace(file_ext, "jpg")  # 更新文件名
                except Exception as e:
                    print(f"图片格式转换失败: {str(e)}")
                    # 如果转换失败，保留原始文件

            return file_name

        except Exception as e:
            print(f"图片下载失败（{pic_url}）: {str(e)}")
            return None

class LoginDialog(QDialog):
    """登录对话框，用于自动获取Cookie"""
    cookie_received = pyqtSignal(str)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("闲鱼登录 - 获取Cookie")
        self.setGeometry(100, 100, 1200, 600)
        
        # 创建主布局
        main_layout = QVBoxLayout()
        self.setLayout(main_layout)
        
        # 添加提示标签
        label = QLabel("请登录您的闲鱼账号，登录成功后会自动获取Cookie")
        label.setStyleSheet("font-size: 14px; font-weight: bold; margin-bottom: 10px;")
        main_layout.addWidget(label)
        
        # 创建浏览器视图
        self.browser = QWebEngineView()
        main_layout.addWidget(self.browser)
        
        # 创建按钮布局
        button_layout = QHBoxLayout()
        main_layout.addLayout(button_layout)
        
        # 添加刷新按钮
        self.refresh_btn = QPushButton("刷新")
        self.refresh_btn.clicked.connect(self.browser.reload)
        self.refresh_btn.setStyleSheet("background-color: #007bff; color: white; padding: 8px 16px;")
        button_layout.addWidget(self.refresh_btn)
        
        # 添加复制Cookie按钮
        self.copy_cookie_btn = QPushButton("复制Cookie")
        self.copy_cookie_btn.clicked.connect(self.copy_cookie)
        self.copy_cookie_btn.setStyleSheet("background-color: #28a745; color: white; padding: 8px 16px;")
        self.copy_cookie_btn.setEnabled(False)  # 初始不可用
        button_layout.addWidget(self.copy_cookie_btn)
        
        # 添加状态标签
        self.status_label = QLabel("等待登录...")
        self.status_label.setStyleSheet("color: #6c757d; font-size: 12px; padding: 5px;")
        main_layout.addWidget(self.status_label)
        
        # 添加关闭按钮
        self.close_btn = QPushButton("关闭")
        self.close_btn.clicked.connect(self.reject)
        self.close_btn.setStyleSheet("background-color: #dc3545; color: white; padding: 8px 16px;")
        button_layout.addWidget(self.close_btn)
        
        # 直接加载登录页面
        login_url = "https://www.goofish.com"
        self.browser.load(QUrl(login_url))
        
        # 监控页面加载完成事件
        self.browser.loadFinished.connect(self.on_load_finished)
        self.login_success = False
        
        # 存储获取到的Cookie
        self.cookie_str = ""
    
    def on_load_finished(self, success):
        """页面加载完成后检查登录状态"""
        if not success or self.login_success:
            return
            
        # 检查当前URL是否包含登录成功标识
        current_url = self.browser.url().toString()
        if "www.goofish.com" in current_url:
            self.check_login_status()
        else:
            # 执行JavaScript检测登录状态
            js_code = """
                (function() {
                    try {
                        // 检查是否有登录用户元素
                        var userElement = document.querySelector('.user-name');
                        if (userElement && userElement.innerText.trim() !== '') {
                            return true;
                        }
                        
                        // 检查是否包含登录成功关键字
                        if (document.body.innerText.includes('我的闲鱼') || 
                            document.body.innerText.includes('已登录')) {
                            return true;
                        }
                    } catch(e) {}
                    return false;
                })();
            """
            self.browser.page().runJavaScript(js_code, self.handle_login_check)
    
    def handle_login_check(self, result):
        """处理JavaScript登录检测结果"""
        if result:
            self.login_success = True
            self.status_label.setText("✅ 登录成功，正在获取Cookie...")
            self.status_label.setStyleSheet("color: #28a745; font-size: 12px; padding: 5px;")
            
            # 使用JavaScript获取Cookie
            self.browser.page().runJavaScript("document.cookie", self.process_js_cookies)
    
    def check_login_status(self):
        """当URL发生变化时检查登录状态"""
        if self.login_success:
            return
            
        self.login_success = True
        self.status_label.setText("✅ 登录成功，正在获取Cookie...")
        self.status_label.setStyleSheet("color: #28a745; font-size: 12px; padding: 5px;")
        
        # 使用JavaScript获取Cookie
        self.browser.page().runJavaScript("document.cookie", self.process_js_cookies)
    
    def process_js_cookies(self, cookie_str):
        """处理通过JavaScript获取的Cookie字符串"""
        try:
            if not cookie_str:
                self.status_label.setText("❌ 未获取到Cookie，请重试")
                self.status_label.setStyleSheet("color: #dc3545; font-size: 12px; padding: 5px;")
                return

            # 构建完整的Cookie字符串
            self.cookie_str = cookie_str.replace('; ', ';')
            self.copy_cookie_btn.setEnabled(True)
            self.status_label.setText("✅ Cookie已获取！可以复制或直接使用")
            
            # 发送Cookie信号给主窗口
            self.cookie_received.emit(self.cookie_str)
        except Exception as e:
            self.status_label.setText(f"❌ 处理Cookie出错: {str(e)}")
            self.status_label.setStyleSheet("color: #dc3545; font-size: 12px; padding: 5px;")
    
    def copy_cookie(self):
        """复制Cookie到剪贴板"""
        if self.cookie_str:
            clipboard = QApplication.clipboard()
            clipboard.setText(self.cookie_str)
            self.status_label.setText("✅ Cookie已复制到剪贴板！")
            self.status_label.setStyleSheet("color: #28a745; font-size: 12px; padding: 5px;")

class XianyuSpiderGUI(QMainWindow):
    """闲鱼爬虫GUI界面（使用PyQt5）"""
    def __init__(self):
        super().__init__()
        self.setWindowTitle("闲鱼商品爬虫 v2.2")
        self.setGeometry(100, 100, 720, 600)
        
        screen_geometry = QApplication.desktop().availableGeometry()  # 获取可用桌面区域（不包括任务栏）
        window_size = self.size()
        x = (screen_geometry.width() - window_size.width()) // 2
        y = (screen_geometry.height() - window_size.height()) // 4
        
        self.move(x, y)  # 移动窗口到居中位置
        
        # 设置全局样式
        self.setStyleSheet("""
            QPushButton {
                background-color: #007bff;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                font-size: 14px;
            }
            QPushButton:hover {
                background-color: #0069d9;
            }
            QPushButton:disabled {
                background-color: #6c757d;
            }
            QLineEdit, QComboBox {
                padding: 6px;
                border: 1px solid #ced4da;
                border-radius: 4px;
            }
            QGroupBox {
                border: 1px solid #dee2e6;
                border-radius: 6px;
                margin-top: 10px;
                font-weight: bold;
            }
            QTextEdit {
                border: 1px solid #ced4da;
                border-radius: 4px;
            }
        """)
        
        # 初始化爬虫
        self.spider = XianyuSpider()
        
        # 工作线程
        self.worker_thread = None
        self.save_thread = None
        
        # 登录对话框引用
        self.login_dialog = None
        
        # 创建界面
        self.init_ui()
    
    def init_ui(self):
        """初始化用户界面"""
        # 创建主控件和布局
        main_widget = QWidget()
        main_layout = QVBoxLayout()
        main_widget.setLayout(main_layout)
        self.setCentralWidget(main_widget)
        
        # 输入区域
        input_group = QGroupBox("爬取设置")
        input_layout = QGridLayout()
        input_layout.setSpacing(20)  # 设置控件间距
        input_group.setLayout(input_layout)
        main_layout.addWidget(input_group)
        
        # Cookie输入
        input_layout.addWidget(QLabel("Cookie:"), 0, 0)
        self.cookie_entry = QLineEdit()
        self.cookie_entry.setText(self.spider.cookie)
        self.cookie_entry.setPlaceholderText("输入闲鱼Cookie或使用自动获取")
        input_layout.addWidget(self.cookie_entry, 0, 1, 1, 6)  # 跨5列
        
        # 自动获取Cookie按钮
        self.get_cookie_btn = QPushButton("自动获取Cookie")
        self.get_cookie_btn.clicked.connect(self.get_cookie)
        input_layout.addWidget(self.get_cookie_btn, 0, 7)
        
        # 关键词输入
        input_layout.addWidget(QLabel("关键词:"), 1, 0)
        self.keyword_entry = QLineEdit()
        self.keyword_entry.setPlaceholderText("输入搜索关键词")
        input_layout.addWidget(self.keyword_entry, 1, 1, 1, 6)  # 跨6列
        
        # 配置行（页数、线程数、价格范围）
        input_layout.addWidget(QLabel("爬取页数:"), 2, 0)
        self.page_entry = QLineEdit("1")
        self.page_entry.setMaximumWidth(60)
        input_layout.addWidget(self.page_entry, 2, 1)
        
        input_layout.addWidget(QLabel("线程数:"), 2, 2)
        self.thread_combo = QComboBox()
        self.thread_combo.addItems([str(i) for i in range(1, MAX_WORKERS + 1)])
        self.thread_combo.setCurrentText(str(MAX_WORKERS))
        self.thread_combo.setMaximumWidth(60)
        input_layout.addWidget(self.thread_combo, 2, 3)
        
        input_layout.addWidget(QLabel("价格范围:"), 2, 4)
        self.min_price_entry = QLineEdit()
        self.min_price_entry.setPlaceholderText("最低价")
        self.min_price_entry.setMaximumWidth(80)
        input_layout.addWidget(self.min_price_entry, 2, 5)
        
        input_layout.addWidget(QLabel("-"), 2, 7)
        self.max_price_entry = QLineEdit()
        self.max_price_entry.setPlaceholderText("最高价")
        self.max_price_entry.setMaximumWidth(80)
        input_layout.addWidget(self.max_price_entry, 2, 6)
        
        # 按钮区域
        button_layout = QHBoxLayout()
        button_layout.setSpacing(10)
        main_layout.addLayout(button_layout)
        
        self.start_btn = QPushButton("开始爬取")
        self.start_btn.clicked.connect(self.start_crawling)
        button_layout.addWidget(self.start_btn)
        
        self.stop_btn = QPushButton("停止")
        self.stop_btn.setEnabled(False)
        self.stop_btn.clicked.connect(self.stop_crawling)
        button_layout.addWidget(self.stop_btn)
        
        self.save_cookie_btn = QPushButton("保存Cookie")
        self.save_cookie_btn.clicked.connect(self.save_cookie)
        button_layout.addWidget(self.save_cookie_btn)
        
        self.clear_log_btn = QPushButton("清除日志")
        self.clear_log_btn.clicked.connect(self.clear_log)
        button_layout.addWidget(self.clear_log_btn)
        
        # 进度条
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setFormat("等待开始")
        main_layout.addWidget(self.progress_bar)
        
        # 日志区域
        log_group = QGroupBox("日志信息")
        log_layout = QVBoxLayout()
        log_layout.setContentsMargins(10, 15, 10, 10)
        log_group.setLayout(log_layout)
        main_layout.addWidget(log_group)
        
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        log_layout.addWidget(self.log_text)
        
        # 状态栏
        self.status_bar = self.statusBar()
        self.status_bar.showMessage("就绪")
    
    def log_message(self, message):
        """记录日志消息"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.append(f"[{timestamp}] {message}")
        self.log_text.moveCursor(QTextCursor.End)
    
    def clear_log(self):
        """清除日志"""
        self.log_text.clear()
    
    def get_cookie(self):
        """打开登录对话框获取Cookie"""
        # 如果已有登录窗口，则将其置顶
        if self.login_dialog and self.login_dialog.isVisible():
            self.login_dialog.activateWindow()
            self.login_dialog.raise_()
            return
            
        self.login_dialog = LoginDialog(self)
        self.login_dialog.cookie_received.connect(self.set_cookie_from_dialog)
        # 设置对话框为模态，但允许主窗口操作
        self.login_dialog.setWindowModality(Qt.NonModal)
        self.login_dialog.show()
    
    def set_cookie_from_dialog(self, cookie):
        """从登录对话框设置Cookie"""
        self.cookie_entry.setText(cookie)
        self.log_message("✅ Cookie已自动获取")
    
    def save_cookie(self):
        """保存Cookie"""
        cookie = self.cookie_entry.text().strip()
        if not cookie:
            QMessageBox.warning(self, "警告", "Cookie不能为空")
            return
        
        if self.spider.save_cookie(cookie):
            self.log_message("✅ Cookie保存成功")
        else:
            self.log_message("❌ Cookie保存失败")
    
    def start_crawling(self):
        """开始爬取"""
        if self.worker_thread and self.worker_thread.isRunning():
            return
        
        # 验证输入
        cookie = self.cookie_entry.text().strip()
        if not cookie:
            QMessageBox.warning(self, "警告", "Cookie不能为空")
            return
        
        keyword = self.keyword_entry.text().strip()
        if not keyword:
            QMessageBox.warning(self, "警告", "关键词不能为空")
            return
        
        try:
            pages = int(self.page_entry.text())
            if pages <= 0:
                QMessageBox.warning(self, "警告", "页数必须是正整数")
                return
        except ValueError:
            QMessageBox.warning(self, "警告", "页数必须是数字")
            return
        
        # 解析价格范围
        min_price = None
        max_price = None
        
        min_price_text = self.min_price_entry.text().strip()
        if min_price_text:
            try:
                min_price = float(min_price_text)
            except ValueError:
                QMessageBox.warning(self, "警告", "最低价格必须是数字")
                return
        
        max_price_text = self.max_price_entry.text().strip()
        if max_price_text:
            try:
                max_price = float(max_price_text)
            except ValueError:
                QMessageBox.warning(self, "警告", "最高价格必须是数字")
                return
        
        if min_price is not None and max_price is not None and min_price > max_price:
            QMessageBox.warning(self, "警告", "最低价格不能大于最高价格")
            return
        
        workers = int(self.thread_combo.currentText())
        
        # 更新爬虫的Cookie
        self.spider.cookie = cookie
        
        # 创建并启动工作线程
        self.worker_thread = WorkerThread(
            self.spider, 
            keyword, 
            pages, 
            workers,
            min_price,
            max_price
        )
        
        # 连接信号
        self.worker_thread.log_signal.connect(self.log_message)
        self.worker_thread.progress_signal.connect(self.update_progress)
        self.worker_thread.status_signal.connect(self.status_bar.showMessage)
        self.worker_thread.finished_signal.connect(self.finish_crawling)
        
        # 更新UI状态
        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self.status_bar.showMessage("爬取中...")
        self.progress_bar.setValue(0)
        self.progress_bar.setFormat("0/%d" % pages)
        
        # 启动线程
        self.worker_thread.start()
        self.log_message("✅ 开始爬取任务...")
    
    def update_progress(self, current_page, total_pages):
        """更新进度条"""
        progress = int((current_page / total_pages) * 100)
        self.progress_bar.setValue(progress)
        self.progress_bar.setFormat(f"{current_page}/{total_pages} 页 ({progress}%)")
    
    def stop_crawling(self):
        """停止爬取"""
        if self.worker_thread and self.worker_thread.isRunning():
            self.worker_thread.stop()
            self.log_message("⏹ 正在停止爬取...")
            self.status_bar.showMessage("正在停止...")
            self.stop_btn.setEnabled(False)
        elif self.save_thread and self.save_thread.isRunning():
            self.save_thread.stop()
            self.log_message("⏹ 正在停止保存过程...")
    
    def finish_crawling(self, results, failed_pages):
        """完成爬取任务"""
        # 报告失败页
        if failed_pages:
            self.log_message(f"⚠️ 以下页爬取失败: {', '.join(map(str, failed_pages))}")
        
        # 如果没有结果，直接返回
        if not results:
            self.log_message("⚠️ 未获取到任何商品数据")
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)
            self.status_bar.showMessage("就绪")
            self.progress_bar.setValue(100)
            self.progress_bar.setFormat("完成")
            return
        
        self.log_message(f"✅ 爬取完成! 共获取 {len(results)} 条商品数据")
        self.log_message("开始保存结果到Excel...")
        
        # 创建并启动保存线程
        keyword = self.keyword_entry.text().strip()
        self.save_thread = SaveResultsThread(self.spider, keyword, results)
        
        # 连接信号
        self.save_thread.log_signal.connect(self.log_message)
        self.save_thread.progress_signal.connect(self.update_save_progress)
        self.save_thread.finished_signal.connect(self.finish_saving)
        
        # 更新UI状态
        self.status_bar.showMessage("正在保存结果...")
        self.progress_bar.setValue(0)
        self.progress_bar.setFormat("0/%d" % len(results))
        
        # 启动保存线程
        self.save_thread.start()
    
    def update_save_progress(self, current_item, total_items):
        """更新保存进度条"""
        progress = int((current_item / total_items) * 100)
        self.progress_bar.setValue(progress)
        self.progress_bar.setFormat(f"{current_item}/{total_items} 项 ({progress}%)")
    
    def finish_saving(self, filename):
        """完成保存任务"""
        if filename:
            self.log_message(f"✅ 数据已保存到 {filename}")
        else:
            self.log_message("❌ 数据保存失败")
        
        # 更新UI状态
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.status_bar.showMessage("就绪")
        self.progress_bar.setValue(100)
        self.progress_bar.setFormat("完成")


def main():
    app = QApplication(sys.argv)
    window = XianyuSpiderGUI()
    window.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()