import asyncio
import io
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from ultralytics import YOLO

app = FastAPI()

# Cấu hình CORS mở rộng
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, "../Assets")
os.makedirs(ASSETS_DIR, exist_ok=True)
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

model_path = os.path.join(BASE_DIR, "finalv11.pt")

if os.path.exists(model_path):
    model = YOLO(model_path)
    print(f"\n[*] MODEL ĐÃ NẠP THÀNH CÔNG!")
    print(f"[*] CÁC NHÃN TRONG MODEL CỦA ANH LÀ: {model.names}")
    print(f"[*] CHẾ ĐỘ: XỬ LÝ SONG SONG ĐỒNG THỜI 8 CAMERA ĐÃ KÍCH HOẠT!\n")
    # ĐÃ XÓA model_lock ĐỂ KHÔNG BẮT 8 CAM PHẢI XẾP HÀNG CHỜ NHAU NỮA
else:
    print(f"[!] LỖI: Không tìm thấy file {model_path}!")
    exit()

def run_yolo_inference(data, cell_id):
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
        
        # CẢI TIẾN: Thêm imgsz=320 để AI chạy nhanh gấp 4 lần, xử lý đồng thời cực mượt
        results = model(image, conf=0.37, imgsz=320, verbose=False)
        
        focus_count = 0
        distracted_count = 0
        
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                class_name = model.names[cls_id].lower()
                
                if 'focus' in class_name or 'tap_trung' in class_name:
                    focus_count += 1
                else:
                    distracted_count += 1
        
        # Trả kết quả ngay lập tức: 1 là Đỏ (Vi phạm), 0 là Xanh (Tập trung)
        if focus_count == 0 and distracted_count == 0:
            return 1 # Không thấy ai trong khung hình -> Đỏ
        elif focus_count >= distracted_count:
            return 0 # Số người tập trung nhiều hơn -> Xanh
        else:
            return 1 # Có người xao nhãng -> Đỏ
            
    except Exception as e:
        print(f"[!] Lỗi xử lý luồng Cam {cell_id}: {e}")
        return 0

@app.websocket("/ws/{cell_id}")
async def websocket_endpoint(websocket: WebSocket, cell_id: int):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_bytes()
            # asyncio.to_thread sẽ tự động chia 8 camera vào 8 luồng xử lý độc lập, chạy cùng một lúc
            detected = await asyncio.to_thread(run_yolo_inference, data, cell_id)
            await websocket.send_bytes(bytes([detected]))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)