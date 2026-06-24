# 👓 Virtual Glasses Try-On

Real-time virtual glasses try-on application using **MediaPipe Face Landmarker**, **Three.js/WebGL**, and **FastAPI** backend.

## ✨ Features

- **Real-time AR**: Try on glasses using your webcam with smooth face tracking
- **468-point face detection**: MediaPipe Face Landmarker for accurate placement
- **3D rendering**: Three.js with PBR materials and smooth interpolation
- **GLB model upload**: Admin panel for uploading .glb/.gltf glasses models
- **JSON metadata**: Upload positioning data (scale, offset, rotation) per model
- **Category browsing**: Filter glasses by sunglasses, eyeglasses, fashion, etc.
- **Dynamic switching**: Change glasses in real-time without reloading
- **Screenshot**: Capture your try-on look
- **Responsive**: Works on desktop and mobile

## 🏗️ Architecture

```
Frontend (HTML/CSS/JS)          Backend (Python FastAPI)
┌──────────────────┐            ┌──────────────────┐
│  Webcam Feed     │            │  REST API        │
│  MediaPipe       │◄──────────►│  SQLAlchemy ORM  │
│  Three.js/WebGL  │  HTTP/API  │  SQLite DB       │
│  Glasses UI      │            │  File Storage    │
└──────────────────┘            └──────────────────┘
```

## 🚀 Quick Start

### 1. Setup Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/Mac
pip install -r requirements.txt
python run.py
```

### 2. Open App

Navigate to **http://localhost:8000** in your browser.

- **Try-On Page**: http://localhost:8000
- **Admin Panel**: http://localhost:8000/admin
- **API Docs**: http://localhost:8000/docs

## 📦 Upload Glasses

### Method 1: Admin Panel (Recommended)
1. Go to http://localhost:8000/admin
2. Drag & drop a `.glb` file
3. Optionally drop a `.json` metadata file
4. Adjust scale/position/rotation with sliders
5. Click "Upload Glasses"

### Method 2: API Upload
```bash
curl -X POST http://localhost:8000/api/glasses/upload \
  -F "file=@glasses.glb" \
  -F 'metadata={"name":"My Glasses","category":"sunglasses","scale_x":1.0,"scale_y":1.0,"scale_z":1.0}'
```

### JSON Metadata Format
```json
{
  "name": "Aviator Sunglasses",
  "category": "sunglasses",
  "brand": "Generic",
  "scale_x": 1.0,
  "scale_y": 1.0,
  "scale_z": 1.0,
  "position_offset_x": 0.0,
  "position_offset_y": 0.0,
  "position_offset_z": 0.0,
  "rotation_offset_x": 0,
  "rotation_offset_y": 0,
  "rotation_offset_z": 0,
  "bridge_width": 0.04,
  "temple_length": 0.12,
  "lens_opacity": 0.3,
  "frame_color": "Gold"
}
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Face Detection | MediaPipe Face Landmarker (468 landmarks) |
| 3D Rendering | Three.js r169 + WebGL |
| Frontend | Vanilla HTML/CSS/JS |
| Backend | Python FastAPI |
| Database | SQLAlchemy + SQLite |
| API Docs | Swagger UI (auto-generated) |

## 📁 Project Structure

```
Virtual-Try-On/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app
│   │   ├── database.py      # SQLAlchemy setup
│   │   ├── models.py        # ORM models
│   │   ├── schemas.py       # Pydantic schemas
│   │   ├── crud.py          # CRUD operations
│   │   └── routers/
│   │       └── glasses.py   # API routes
│   ├── uploads/             # GLB file storage
│   ├── requirements.txt
│   └── run.py
├── frontend/
│   ├── index.html           # Try-on page
│   ├── admin.html           # Admin panel
│   ├── css/styles.css       # Design system
│   └── js/
│       ├── app.js           # Main controller
│       ├── faceTracker.js   # MediaPipe integration
│       ├── glassesRenderer.js # Three.js rendering
│       ├── cameraManager.js # Webcam management
│       ├── glassesAPI.js    # API client
│       └── admin.js         # Admin panel logic
└── README.md
```

## 📝 License

MIT License
