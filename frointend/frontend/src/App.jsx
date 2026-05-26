import React, { useEffect, useRef, useState } from 'react';
import './App.css';

const TOTAL_GRIDS = 9; 
const BACKEND_URL = "http://100.72.34.80:6868"; 

const VIDEO_LIST = [
  "IMG_1949.MOV", "IMG_1950.MOV", "IMG_1951.MOV", "IMG_1952.MOV", 
  "IMG_1991.MOV", "IMG_1994.MOV", "IMG_8540.MOV", "IMG_8541.MOV"
];

function VideoCell({ id, isRealCamera, videoSrc, wsUrl, isDetectionActive, globalPlay, onStatusChange, onViolation }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const [detectStatus, setDetectStatus] = useState(null); 
  const lastLogTime = useRef(0);
  const lastSendTime = useRef(0);
  const isProcessing = useRef(false);

  useEffect(() => {
    if (isRealCamera) {
      navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } })
        .then(stream => { if (videoRef.current) videoRef.current.srcObject = stream; })
        .catch(err => console.error("Lỗi Camera cá nhân:", err));
    }

    wsRef.current = new WebSocket(wsUrl);
    wsRef.current.binaryType = "arraybuffer";

    wsRef.current.onmessage = (event) => {
      isProcessing.current = false;
      const status = new Uint8Array(event.data)[0];
      setDetectStatus(status);
      onStatusChange(id, status);
    };

    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [id, isRealCamera, wsUrl, onStatusChange]);

  useEffect(() => {
    if (isDetectionActive && detectStatus === 1) {
      const now = Date.now();
      if (now - lastLogTime.current > 10000) {
        onViolation(id);
        lastLogTime.current = now;
      }
    }
  }, [detectStatus, isDetectionActive, id, onViolation]);

  useEffect(() => {
    if (!isDetectionActive) {
      setDetectStatus(null);
      onStatusChange(id, null);
      isProcessing.current = false;
    }
  }, [isDetectionActive, id, onStatusChange]);

  useEffect(() => {
    if (isRealCamera) return; 

    const PROCESS_FPS = 2; 
    const interval = setInterval(() => {
      if (!isDetectionActive) return;
      if (!videoRef.current || !canvasRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
      
      if (isProcessing.current) {
        if (Date.now() - lastSendTime.current > 4000) {
          isProcessing.current = false; 
        } else {
          return;
        }
      }
      
      const video = videoRef.current;
      if (video.readyState >= 2 && !video.paused && !video.ended && video.videoHeight > 0) { 
        try {
          const scale = 480 / video.videoHeight;
          const drawWidth = video.videoWidth * scale;
          const drawHeight = 480;

          canvasRef.current.width = drawWidth;
          canvasRef.current.height = drawHeight;
          
          const ctx = canvasRef.current.getContext('2d');
          ctx.drawImage(video, 0, 0, drawWidth, drawHeight); 
          
          canvasRef.current.toBlob((blob) => {
            if (blob && wsRef.current?.readyState === WebSocket.OPEN) {
              isProcessing.current = true; 
              lastSendTime.current = Date.now();
              blob.arrayBuffer().then(buffer => wsRef.current.send(buffer));
            }
          }, 'image/jpeg', 0.8); 
        } catch (error) {
           console.error(`[LỖI CAM ${id}] Trình duyệt chặn gửi ảnh (Tainted Canvas CORS):`, error.message);
        }
      }
    }, 1000 / PROCESS_FPS);

    return () => clearInterval(interval);
  }, [isRealCamera, isDetectionActive]);

  useEffect(() => {
    if (isRealCamera || !videoRef.current) return;
    if (globalPlay) {
      videoRef.current.play().catch(e => console.log(e));
    } else {
      videoRef.current.pause();
    }
  }, [globalPlay, isRealCamera]);

  const handleForceLoop = (e) => {
    e.target.currentTime = 0;
    e.target.play().catch(err => console.log(err));
  };

  let borderClass = '';
  if (isDetectionActive && !isRealCamera) {
    if (detectStatus === 1) borderClass = 'alert-distracted'; 
    else if (detectStatus === 0) borderClass = 'alert-focus'; 
  }

  return (
    <div className={`video-cell ${borderClass}`}>
      {isRealCamera ? (
        <video ref={videoRef} autoPlay playsInline muted className="video-player teacher-cam" />
      ) : (
        <video 
          ref={videoRef} src={videoSrc} autoPlay playsInline muted loop={true}
          onEnded={handleForceLoop} crossOrigin="anonymous" className="video-player" 
        />
      )}
      {!isRealCamera && <canvas ref={canvasRef} style={{ display: 'none' }} />}
      <div className="cell-label">{isRealCamera ? "GIÁO VIÊN (CỦA TÔI)" : `CAM ${id}`}</div>
    </div>
  );
}

export default function App() {
  const [isDetectionActive, setIsDetectionActive] = useState(false);
  const [globalPlay, setGlobalPlay] = useState(false);
  const [studentStatuses, setStudentStatuses] = useState({});
  const [isMinimized, setIsMinimized] = useState(false);
  const [logs, setLogs] = useState([]);
  const [sessionStats, setSessionStats] = useState({ scans: 0, focusSum: 0, distSum: 0 });
  const [showReport, setShowReport] = useState(false);

  const handleStatusChange = (id, status) => {
    setStudentStatuses(prev => {
      if (status === null) {
        if (!(id in prev)) return prev;
        const newState = { ...prev };
        delete newState[id];
        return newState;
      }
      if (prev[id] === status) return prev; 
      return { ...prev, [id]: status };
    });
  };

  const handleViolation = (id) => {
    const time = new Date().toLocaleTimeString('vi-VN');
    setLogs(prev => {
      const newLogs = [{ id: Date.now() + id, time, name: `CAM ${id}`, reason: "Mất tập trung", typeClass: "distracted" }, ...prev];
      if (newLogs.length > 50) newLogs.pop();
      return newLogs;
    });
  };

  const startMonitoring = () => {
    setIsDetectionActive(true);
    setLogs([]);
    setSessionStats({ scans: 0, focusSum: 0, distSum: 0 });
    setShowReport(false);
  };

  const stopMonitoring = () => {
    setIsDetectionActive(false);
    setShowReport(true);
  };

  const totalDetected = Object.keys(studentStatuses).length; 
  const distractedCount = Object.values(studentStatuses).filter(val => val === 1).length;
  const focusedCount = totalDetected - distractedCount;
  const focusedPercent = totalDetected > 0 ? Math.round((focusedCount / totalDetected) * 100) : 100;

  const focusedPercentRef = useRef(focusedPercent);
  useEffect(() => {
    focusedPercentRef.current = focusedPercent;
  }, [focusedPercent]);

  useEffect(() => {
    if (!isDetectionActive) return;
    const interval = setInterval(() => {
      setSessionStats(prev => ({
        scans: prev.scans + 1,
        focusSum: prev.focusSum + focusedPercentRef.current,
        distSum: prev.distSum + (100 - focusedPercentRef.current)
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, [isDetectionActive]);

  const avgFocus = sessionStats.scans > 0 ? Math.round(sessionStats.focusSum / sessionStats.scans) : 0;
  const avgDist = sessionStats.scans > 0 ? Math.round(sessionStats.distSum / sessionStats.scans) : 0;

  return (
    <div className="app-container">
      <div className="dashboard">
        {Array.from({ length: TOTAL_GRIDS }).map((_, index) => {
          const id = index + 1;
          const isRealCamera = id === TOTAL_GRIDS; 
          
          const videoSrc = !isRealCamera ? `${BACKEND_URL}/assets/${VIDEO_LIST[index]}` : null;
          const wsUrl = `ws://100.72.34.80:6868/ws/${id}`;

          return (
            <VideoCell 
              key={id} id={id} isRealCamera={isRealCamera} videoSrc={videoSrc} wsUrl={wsUrl}
              isDetectionActive={isDetectionActive} globalPlay={globalPlay}
              onStatusChange={handleStatusChange} onViolation={handleViolation}
            />
          );
        })}
      </div>

      <div id="ai-dashboard">
        <div className="dashboard-header">
            <span className="dashboard-title">FOCUS TRACKER PRO</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span id="status-indicator" style={{ color: isDetectionActive ? '#00d2ff' : '#fff' }}>
                  {isDetectionActive ? 'ĐANG QUÉT...' : 'OFFLINE'}
                </span>
                <button className="btn-icon" title="Thu gọn" onClick={() => setIsMinimized(!isMinimized)}>
                  {isMinimized ? '➕' : '➖'}
                </button>
            </div>
        </div>
        
        {!isMinimized && (
          <div id="dashboard-body">
            <div className="btn-group" style={{ marginBottom: '10px' }}>
                <button 
                  className="btn-control" 
                  style={{ background: globalPlay ? '#fca130' : '#4b5563', color: '#fff' }}
                  onClick={() => setGlobalPlay(!globalPlay)}
                >
                  {globalPlay ? '⏸ DỪNG PHÁT VIDEO' : '▶️ PHÁT ĐỒNG LOẠT'}
                </button>
            </div>

            <div className="stat-card">
                <div className="stat-row">
                    <span>Lớp học Focus:</span>
                    <strong style={{ color: 'var(--primary-color)' }}>{focusedPercent}%</strong>
                </div>
                <div className="progress-container">
                    <div id="focus-bar" style={{ width: `${focusedPercent}%` }}></div>
                </div>
            </div>

            <div className="btn-group">
                {!isDetectionActive ? (
                  <button className="btn-control btn-start" onClick={startMonitoring}>BẮT ĐẦU QUÉT AI</button>
                ) : (
                  <button className="btn-control btn-stop" onClick={stopMonitoring}>DỪNG QUÉT AI</button>
                )}
            </div>
            
            <div className="log-title">
                <span>🔴 DANH SÁCH VI PHẠM:</span>
                <span style={{ color: '#00d2ff', fontWeight: 'bold' }}>{logs.length}</span>
            </div>
            
            <div id="log-list">
                {logs.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#aaa', fontSize: '12px', marginTop: '20px' }}>
                    {isDetectionActive ? 'Hệ thống đang quét...' : 'Chưa kích hoạt hoặc không có vi phạm'}
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className={`log-entry ${log.typeClass}`}>
                        <div className="log-time">[{log.time}]</div>
                        <div className="log-name">{log.name}</div>
                        <div className="log-reason">🔴 {log.reason}</div>
                    </div>
                  ))
                )}
            </div>
          </div>
        )}
      </div>

      {showReport && (
        <div id="final-report" style={{ display: 'block' }}>
            <h2 style={{ marginTop: 0, color: '#111', fontSize: '20px', fontWeight: '800' }}>TỔNG KẾT TIẾT HỌC</h2>
            <p style={{ color: '#666', fontSize: '13px', marginBottom: 0 }}>Chỉ số tập trung tích lũy</p>
            
            <div className="report-stat-box">
                <div>
                    <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>🟢 TẬP TRUNG</div>
                    <div style={{ fontSize: '36px', fontWeight: 900, color: '#00d2ff', marginTop: '5px' }}>{avgFocus}%</div>
                </div>
                <div>
                    <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>🔴 XAO NHÃNG</div>
                    <div style={{ fontSize: '36px', fontWeight: 900, color: '#ff4b2b', marginTop: '5px' }}>{avgDist}%</div>
                </div>
            </div>
            
            <button className="btn-control" style={{ background: '#e5e7eb', color: '#1f2937', width: '100%', borderRadius: '8px', fontWeight: '700' }} onClick={() => setShowReport(false)}>
              XÁC NHẬN ĐÓNG
            </button>
        </div>
      )}
    </div>
  );
}