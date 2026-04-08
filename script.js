// ============ 获取 MediaPipe 绘图函数 ============
const drawConnectors = window.drawConnectors;
const drawLandmarks = window.drawLandmarks;
const HAND_CONNECTIONS = window.HAND_CONNECTIONS;

// ============ DOM 元素 ============
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const glassOverlay = document.getElementById('glassOverlay');
const lightRect = document.getElementById('lightRect');

// 绘图画板
const drawingCanvas = document.createElement('canvas');
drawingCanvas.id = 'drawing-canvas';
drawingCanvas.style.position = 'absolute';
drawingCanvas.style.top = '0';
drawingCanvas.style.left = '0';
drawingCanvas.style.width = '100%';
drawingCanvas.style.height = '100%';
drawingCanvas.style.pointerEvents = 'none';
drawingCanvas.style.zIndex = '15';
document.querySelector('.video-container').appendChild(drawingCanvas);
const drawingCtx = drawingCanvas.getContext('2d');

// 烟花 Canvas
const fireworkCanvas = document.createElement('canvas');
fireworkCanvas.id = 'firework-canvas';
fireworkCanvas.style.position = 'absolute';
fireworkCanvas.style.top = '0';
fireworkCanvas.style.left = '0';
fireworkCanvas.style.width = '100%';
fireworkCanvas.style.height = '100%';
fireworkCanvas.style.pointerEvents = 'none';
fireworkCanvas.style.zIndex = '20';
document.querySelector('.video-container').appendChild(fireworkCanvas);
const fireworkCtx = fireworkCanvas.getContext('2d');

// ============ 全局变量 ============
let leftPinchPoint = null;
let rightPinchPoint = null;
let leftPinchActive = false;
let rightPinchActive = false;

let leftOpenActive = false;
let rightOpenActive = false;

let isFullBright = false;
let isInPinchMode = false;

// 绘图相关
let lastX = 0, lastY = 0;
let rainbowHue = 0;
let lastDrawTime = 0;

// 坐标平滑队列
let smoothPositions = [];
const SMOOTH_COUNT = 3;

// 分别设置偏移补偿
let PINCH_OFFSET = 0;
let DRAW_OFFSET = 0;

// 烟花相关
let activeFireworks = [];
let lastFireworkTime = 0;
const FIREWORK_COOLDOWN = 400;

// MediaPipe
let hands = null;
let camera = null;

let videoWidth = 640;
let videoHeight = 480;

const videoContainer = document.querySelector('.video-container');
let containerRectCache = { width: 640, height: 480 };
let pinchTransform = { displayWidth: 640, displayHeight: 480, offsetX: 0, offsetY: 0 };
let drawTransform = { displayWidth: 640, displayHeight: 480, offsetX: 0, offsetY: 0 };
let lastLightRectSignature = '';
let lastOverlayDisplay = '';
let lastRectDisplay = '';
let leftPinchStable = false;
let rightPinchStable = false;
let leftSmoothedPinchPoint = null;
let rightSmoothedPinchPoint = null;
let smoothedLightRect = null;

const PINCH_ENTER_DISTANCE = 0.045;
const PINCH_EXIT_DISTANCE = 0.065;
const PINCH_POINT_SMOOTHING = 0.35;
const RECT_SMOOTHING = 0.28;

function getContainerRect() {
    return containerRectCache;
}

function computeTransform(canvasWidth, canvasHeight) {
    const videoAspect = videoWidth / videoHeight;
    const containerAspect = canvasWidth / canvasHeight;

    let displayWidth, displayHeight, offsetX, offsetY;

    if (videoAspect > containerAspect) {
        displayHeight = canvasHeight;
        displayWidth = displayHeight * videoAspect;
        offsetX = (canvasWidth - displayWidth) / 2;
        offsetY = 0;
    } else {
        displayWidth = canvasWidth;
        displayHeight = displayWidth / videoAspect;
        offsetX = 0;
        offsetY = (canvasHeight - displayHeight) / 2;
    }

    return { displayWidth, displayHeight, offsetX, offsetY };
}

function refreshLayoutMetrics() {
    const rect = videoContainer.getBoundingClientRect();
    containerRectCache = { width: rect.width, height: rect.height };
    pinchTransform = computeTransform(rect.width, rect.height);
    drawTransform = computeTransform(rect.width, rect.height);
}

function setOverlayDisplay(displayValue) {
    if (lastOverlayDisplay !== displayValue) {
        glassOverlay.style.display = displayValue;
        lastOverlayDisplay = displayValue;
    }
}

function setLightRectDisplay(displayValue) {
    if (lastRectDisplay !== displayValue) {
        lightRect.style.display = displayValue;
        lastRectDisplay = displayValue;
    }
}

function smoothPoint(prev, next, alpha) {
    if (!next) return prev;
    if (!prev) return { x: next.x, y: next.y };
    return {
        x: prev.x + (next.x - prev.x) * alpha,
        y: prev.y + (next.y - prev.y) * alpha
    };
}

// ============ 现实风格烟花系统 ============
class FireworkParticle {
    constructor(x, y, color, isTrail = false) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = isTrail ? Math.random() * 3 + 1 : Math.random() * 5 + 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - (isTrail ? 1 : 2);
        this.color = color;
        this.size = isTrail ? Math.random() * 2 + 1 : Math.random() * 3 + 1.5;
        this.life = 1;
        this.decay = 0.02 + Math.random() * 0.02;
        this.isTrail = isTrail;
        this.gravity = 0.15;
    }
    
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += this.gravity;
        this.life -= this.decay;
        return this.life > 0;
    }
    
    draw(ctx) {
        ctx.globalAlpha = this.life * 0.9;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.globalAlpha = this.life * 0.3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

class RealisticFirework {
    constructor(x, y) {
        this.particles = [];
        const colors = [
            '#FFD700', '#FFC125', '#FF4500', '#FF6347',
            '#FF0000', '#DC143C', '#FF8C00', '#FFA500',
            '#FFFF00', '#FFFACD', '#FFFFFF', '#FFF8DC',
            '#ADFF2F', '#7CFC00'
        ];
        
        const mainCount = 45 + Math.floor(Math.random() * 30);
        for (let i = 0; i < mainCount; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.particles.push(new FireworkParticle(x, y, color, false));
        }
        
        const trailCount = 20 + Math.floor(Math.random() * 20);
        for (let i = 0; i < trailCount; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.particles.push(new FireworkParticle(x, y, color, true));
        }
        
        const sparkCount = 15 + Math.floor(Math.random() * 15);
        for (let i = 0; i < sparkCount; i++) {
            const spark = new FireworkParticle(x, y, '#FFAA33', false);
            spark.size = Math.random() * 2 + 0.5;
            spark.gravity = 0.25;
            this.particles.push(spark);
        }
    }
    
    update() {
        let allDead = true;
        for (let i = this.particles.length - 1; i >= 0; i--) {
            if (!this.particles[i].update()) {
                this.particles.splice(i, 1);
            } else {
                allDead = false;
            }
        }
        return !allDead;
    }
    
    draw(ctx) {
        for (let particle of this.particles) {
            particle.draw(ctx);
        }
    }
}

function initFireworkCanvas() {
    const rect = getContainerRect();
    fireworkCanvas.width = rect.width;
    fireworkCanvas.height = rect.height;
}

function createFirework(x, y) {
    activeFireworks.push(new RealisticFirework(x, y));
}

function createMultiFirework() {
    const rect = getContainerRect();
    const count = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
        const x = Math.random() * rect.width;
        const y = Math.random() * rect.height * 0.6 + 30;
        createFirework(x, y);
    }
}

function updateFireworks() {
    fireworkCtx.clearRect(0, 0, fireworkCanvas.width, fireworkCanvas.height);
    
    for (let i = activeFireworks.length - 1; i >= 0; i--) {
        if (!activeFireworks[i].update()) {
            activeFireworks.splice(i, 1);
        } else {
            activeFireworks[i].draw(fireworkCtx);
        }
    }
    
    requestAnimationFrame(updateFireworks);
}

// ============ 坐标转换 ============

function mediapipeToPinchCoords(x, y) {
    const mappedX = (1 - x) * pinchTransform.displayWidth + pinchTransform.offsetX + PINCH_OFFSET;
    const mappedY = y * pinchTransform.displayHeight + pinchTransform.offsetY;

    return { x: mappedX, y: mappedY };
}

function mediapipeToDrawCoords(x, y) {
    const mappedX = (1 - x) * drawTransform.displayWidth + drawTransform.offsetX + DRAW_OFFSET;
    const mappedY = y * drawTransform.displayHeight + drawTransform.offsetY;

    return { x: mappedX, y: mappedY };
}

// ============ 坐标平滑函数 ============
function smoothCoordinate(newX, newY) {
    smoothPositions.push({ x: newX, y: newY });
    if (smoothPositions.length > SMOOTH_COUNT) {
        smoothPositions.shift();
    }
    
    let sumX = 0, sumY = 0;
    for (let p of smoothPositions) {
        sumX += p.x;
        sumY += p.y;
    }
    
    return {
        x: sumX / smoothPositions.length,
        y: sumY / smoothPositions.length
    };
}

// ============ 插值绘制 ============
function interpolateAndDraw(fromX, fromY, toX, toY, speed) {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    
    if (distance < 2) {
        drawLineWithStyle(fromX, fromY, toX, toY, speed);
        return;
    }
    
    const steps = Math.max(1, Math.floor(distance / 2));
    
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const interpX = fromX + (toX - fromX) * t;
        const interpY = fromY + (toY - fromY) * t;
        
        if (i === 1) {
            drawLineWithStyle(fromX, fromY, interpX, interpY, speed);
        } else if (i === steps) {
            drawLineWithStyle(interpX, interpY, toX, toY, speed);
        } else {
            drawLineWithStyle(interpX, interpY, interpX + 1, interpY + 1, speed * 0.8);
        }
    }
}

// ============ 快速移动时的断线重连 ============
function drawFastMovement(fromX, fromY, toX, toY, speed) {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    
    if (distance > 50) {
        const steps = Math.min(30, Math.floor(distance / 3));
        for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            const interpX = fromX + (toX - fromX) * t;
            const interpY = fromY + (toY - fromY) * t;
            if (step === 1) {
                drawLineWithStyle(fromX, fromY, interpX, interpY, speed);
            } else {
                drawLineWithStyle(interpX - 1, interpY - 1, interpX, interpY, speed * 0.6);
            }
        }
    } else {
        interpolateAndDraw(fromX, fromY, toX, toY, speed);
    }
}

// ============ 手势判断 ============
function isPinching(landmarks, wasPinching = false) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return wasPinching ? distance < PINCH_EXIT_DISTANCE : distance < PINCH_ENTER_DISTANCE;
}

function isOnlyIndexFinger(landmarks) {
    const indexTip = landmarks[8];
    const indexBase = landmarks[5];
    const middleTip = landmarks[12];
    const middleBase = landmarks[9];
    const ringTip = landmarks[16];
    const ringBase = landmarks[13];
    const pinkyTip = landmarks[20];
    const pinkyBase = landmarks[17];
    
    const indexUp = indexTip.y < indexBase.y - 0.02;
    const middleDown = middleTip.y > middleBase.y - 0.01;
    const ringDown = ringTip.y > ringBase.y - 0.01;
    const pinkyDown = pinkyTip.y > pinkyBase.y - 0.01;
    
    return indexUp && middleDown && ringDown && pinkyDown;
}

function isOpenPalm(landmarks) {
    const indexTip = landmarks[8];
    const indexBase = landmarks[5];
    const middleTip = landmarks[12];
    const middleBase = landmarks[9];
    const ringTip = landmarks[16];
    const ringBase = landmarks[13];
    const pinkyTip = landmarks[20];
    const pinkyBase = landmarks[17];
    
    return indexTip.y < indexBase.y &&
           middleTip.y < middleBase.y &&
           ringTip.y < ringBase.y &&
           pinkyTip.y < pinkyBase.y;
}

// 判断是否为 "yeah" 手势（食指+中指伸直，其余手指收起）
function isYeahGesture(landmarks) {
    const indexTip = landmarks[8];
    const indexBase = landmarks[5];
    const middleTip = landmarks[12];
    const middleBase = landmarks[9];
    const ringTip = landmarks[16];
    const ringBase = landmarks[13];
    const pinkyTip = landmarks[20];
    const pinkyBase = landmarks[17];

    const indexStraight = indexTip.y < indexBase.y - 0.015;
    const middleStraight = middleTip.y < middleBase.y - 0.015;
    const ringBent = ringTip.y > ringBase.y - 0.005;
    const pinkyBent = pinkyTip.y > pinkyBase.y - 0.005;

    return indexStraight && middleStraight && ringBent && pinkyBent;
}

// 新增：判断是否握拳（所有手指都弯曲）
function isFist(landmarks) {
    const indexTip = landmarks[8];
    const indexBase = landmarks[5];
    const middleTip = landmarks[12];
    const middleBase = landmarks[9];
    const ringTip = landmarks[16];
    const ringBase = landmarks[13];
    const pinkyTip = landmarks[20];
    const pinkyBase = landmarks[17];
    const thumbTip = landmarks[4];
    const thumbBase = landmarks[2];
    
    // 所有手指都弯曲
    const indexBent = indexTip.y > indexBase.y;
    const middleBent = middleTip.y > middleBase.y;
    const ringBent = ringTip.y > ringBase.y;
    const pinkyBent = pinkyTip.y > pinkyBase.y;
    const thumbBent = thumbTip.x > thumbBase.x;
    
    return indexBent && middleBent && ringBent && pinkyBent && thumbBent;
}

function getFingertipPosition(landmarks) {
    const indexTip = landmarks[8];
    return mediapipeToDrawCoords(indexTip.x, indexTip.y);
}

function getPinchPoint(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const centerX = (thumbTip.x + indexTip.x) / 2;
    const centerY = (thumbTip.y + indexTip.y) / 2;
    return mediapipeToPinchCoords(centerX, centerY);
}

// ============ 绘图功能 ============

function initDrawingCanvas() {
    const rect = getContainerRect();
    drawingCanvas.width = rect.width;
    drawingCanvas.height = rect.height;
    drawingCtx.lineCap = 'round';
    drawingCtx.lineJoin = 'round';
}

function getLineWidth(speed) {
    let width = 14 - Math.min(10, speed / 5);
    return Math.max(3, Math.min(14, width));
}

function drawLineWithStyle(fromX, fromY, toX, toY, speed) {
    rainbowHue = (rainbowHue + 2) % 360;
    
    const distance = Math.hypot(toX - fromX, toY - fromY);
    if (distance < 0.5) return;
    
    const lineWidth = getLineWidth(speed);
    
    const gradient = drawingCtx.createLinearGradient(fromX, fromY, toX, toY);
    gradient.addColorStop(0, `hsla(${rainbowHue}, 100%, 60%, 0.95)`);
    gradient.addColorStop(0.5, `hsla(${(rainbowHue + 8) % 360}, 100%, 65%, 1)`);
    gradient.addColorStop(1, `hsla(${(rainbowHue + 4) % 360}, 100%, 60%, 0.95)`);
    
    drawingCtx.strokeStyle = gradient;
    drawingCtx.lineWidth = lineWidth;
    drawingCtx.globalAlpha = 0.92;
    
    drawingCtx.beginPath();
    drawingCtx.moveTo(fromX, fromY);
    drawingCtx.lineTo(toX, toY);
    drawingCtx.stroke();
    
    drawingCtx.globalAlpha = 1;
}

function clearDrawing() {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
}

// ============ 状态管理 ============
function setFullBright() {
    if (!isFullBright) {
        isFullBright = true;
        isInPinchMode = false;
        setOverlayDisplay('none');
        setLightRectDisplay('none');
    }
}

function enterPinchMode() {
    if (isFullBright) {
        isFullBright = false;
    }
    isInPinchMode = true;
    setOverlayDisplay('block');
    setLightRectDisplay('none');
}

function updateLightRect() {
    if (isFullBright) return;
    
    if (isInPinchMode && leftPinchActive && rightPinchActive && leftPinchPoint && rightPinchPoint) {
        const targetX1 = Math.min(leftPinchPoint.x, rightPinchPoint.x);
        const targetY1 = Math.min(leftPinchPoint.y, rightPinchPoint.y);
        const targetX2 = Math.max(leftPinchPoint.x, rightPinchPoint.x);
        const targetY2 = Math.max(leftPinchPoint.y, rightPinchPoint.y);

        if (!smoothedLightRect) {
            smoothedLightRect = { x1: targetX1, y1: targetY1, x2: targetX2, y2: targetY2 };
        } else {
            smoothedLightRect.x1 += (targetX1 - smoothedLightRect.x1) * RECT_SMOOTHING;
            smoothedLightRect.y1 += (targetY1 - smoothedLightRect.y1) * RECT_SMOOTHING;
            smoothedLightRect.x2 += (targetX2 - smoothedLightRect.x2) * RECT_SMOOTHING;
            smoothedLightRect.y2 += (targetY2 - smoothedLightRect.y2) * RECT_SMOOTHING;
        }

        const x1 = smoothedLightRect.x1;
        const y1 = smoothedLightRect.y1;
        const x2 = smoothedLightRect.x2;
        const y2 = smoothedLightRect.y2;
        
        const width = x2 - x1;
        const height = y2 - y1;
        
        if (width > 10 && height > 10) {
            const signature = `${Math.round(x1)},${Math.round(y1)},${Math.round(width)},${Math.round(height)}`;
            setLightRectDisplay('block');
            if (signature !== lastLightRectSignature) {
                lightRect.style.left = x1 + 'px';
                lightRect.style.top = y1 + 'px';
                lightRect.style.width = width + 'px';
                lightRect.style.height = height + 'px';
                lastLightRectSignature = signature;
            }
            setOverlayDisplay('none');
            return;
        }
    }
    
    setLightRectDisplay('none');
    lastLightRectSignature = '';
    smoothedLightRect = null;
    if (!isFullBright) {
        setOverlayDisplay('block');
    }
}

// ============ 挥手擦除 ============
let handPositions = [];
let lastEraseTime = 0;

function detectWipeAndErase(handX, handY) {
    const now = Date.now();
    handPositions.push({ x: handX, y: handY, time: now });
    handPositions = handPositions.filter(p => now - p.time < 200);
    
    if (handPositions.length > 2) {
        const first = handPositions[0];
        const last = handPositions[handPositions.length - 1];
        const distance = Math.hypot(last.x - first.x, last.y - first.y);
        
        if (distance > 40 && now - lastEraseTime > 30) {
            lastEraseTime = now;
            
            drawingCtx.globalCompositeOperation = 'destination-out';
            drawingCtx.beginPath();
            drawingCtx.arc(handX, handY, 50, 0, Math.PI * 2);
            drawingCtx.fill();
            drawingCtx.globalCompositeOperation = 'source-over';
            return true;
        }
    }
    return false;
}

// ============ MediaPipe 处理 ============
function onResults(results) {
    if (!canvasCtx) return;
    
    if (videoElement.videoWidth) {
        const hasVideoSizeChanged = videoWidth !== videoElement.videoWidth || videoHeight !== videoElement.videoHeight;
        videoWidth = videoElement.videoWidth;
        videoHeight = videoElement.videoHeight;
        if (hasVideoSizeChanged) {
            refreshLayoutMetrics();
        }
    }
    
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    leftPinchActive = false;
    rightPinchActive = false;
    leftOpenActive = false;
    rightOpenActive = false;
    leftPinchPoint = null;
    rightPinchPoint = null;
    
    let currentBothPinch = false;
    let currentBothOpen = false;
    let currentIndexFingerPos = null;
    let currentOpenPalmPos = null;
    let indexFingerDetected = false;
    let yeahDetected = false;
    let fistDetected = false;  // 新增：握拳检测
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness[i].label;
            
            const wasPinching = handedness === 'Left' ? leftPinchStable : rightPinchStable;
            const isPinchingNow = isPinching(landmarks, wasPinching);
            const isOpenNow = isOpenPalm(landmarks);
            const isIndexOnly = isOnlyIndexFinger(landmarks);
            const isYeahNow = isYeahGesture(landmarks);
            const isFistNow = isFist(landmarks);  // 新增：握拳检测
            
            if (isPinchingNow) {
                const rawPinchPoint = getPinchPoint(landmarks);
                if (handedness === 'Left') {
                    leftPinchStable = true;
                    leftPinchActive = true;
                    leftSmoothedPinchPoint = smoothPoint(leftSmoothedPinchPoint, rawPinchPoint, PINCH_POINT_SMOOTHING);
                    leftPinchPoint = leftSmoothedPinchPoint;
                } else {
                    rightPinchStable = true;
                    rightPinchActive = true;
                    rightSmoothedPinchPoint = smoothPoint(rightSmoothedPinchPoint, rawPinchPoint, PINCH_POINT_SMOOTHING);
                    rightPinchPoint = rightSmoothedPinchPoint;
                }
            } else if (handedness === 'Left') {
                leftPinchStable = false;
                leftSmoothedPinchPoint = null;
            } else {
                rightPinchStable = false;
                rightSmoothedPinchPoint = null;
            }
            
            if (isOpenNow) {
                if (handedness === 'Left') {
                    leftOpenActive = true;
                } else {
                    rightOpenActive = true;
                }
                const palmPos = getFingertipPosition(landmarks);
                currentOpenPalmPos = palmPos;
            }
            
            if (isIndexOnly && isFullBright && !isYeahNow) {
                indexFingerDetected = true;
                currentIndexFingerPos = getFingertipPosition(landmarks);
            }
            
            if (isYeahNow) {
                yeahDetected = true;
            }
            
            if (isFistNow) {
                fistDetected = true;
            }
        }
        
        currentBothPinch = leftPinchActive && rightPinchActive;
        currentBothOpen = leftOpenActive && rightOpenActive;
    } else {
        leftPinchStable = false;
        rightPinchStable = false;
        leftSmoothedPinchPoint = null;
        rightSmoothedPinchPoint = null;
    }
    
    // 握拳清空画板
    if (fistDetected) {
        clearDrawing();
    }
    
    // 烟花触发
    const now = Date.now();
    if (yeahDetected && !currentBothPinch && now - lastFireworkTime > FIREWORK_COOLDOWN) {
        lastFireworkTime = now;
        createMultiFirework();
    }
    
    // 状态机
    if (isFullBright && currentBothPinch) {
        enterPinchMode();
        clearDrawing();
        smoothPositions = [];
    } else if (!isFullBright && !isInPinchMode && currentBothPinch) {
        enterPinchMode();
    } else if (!isFullBright && isInPinchMode && currentBothOpen) {
        setFullBright();
    } else if (isInPinchMode && !isFullBright && !currentBothPinch) {
        setOverlayDisplay('block');
        setLightRectDisplay('none');
    }
    
    // 全亮模式下的线条绘制
    if (isFullBright) {
        if (indexFingerDetected && currentIndexFingerPos && !yeahDetected) {
            const smoothed = smoothCoordinate(currentIndexFingerPos.x, currentIndexFingerPos.y);
            
            if (lastX !== 0 && lastY !== 0) {
                const nowTime = performance.now();
                const dt = Math.max(1, nowTime - lastDrawTime);
                const distance = Math.hypot(smoothed.x - lastX, smoothed.y - lastY);
                const speed = (distance / dt) * 1000;
                
                drawFastMovement(lastX, lastY, smoothed.x, smoothed.y, speed);
                lastDrawTime = nowTime;
            } else {
                lastDrawTime = performance.now();
            }
            lastX = smoothed.x;
            lastY = smoothed.y;
        } else {
            lastX = 0;
            lastY = 0;
            smoothPositions = [];
        }
        
        if (currentOpenPalmPos) {
            detectWipeAndErase(currentOpenPalmPos.x, currentOpenPalmPos.y);
        }
    }
    
    // 矩形框预览
    if (!isFullBright && isInPinchMode && leftPinchPoint && rightPinchPoint && leftPinchActive && rightPinchActive) {
        const x1 = Math.min(leftPinchPoint.x, rightPinchPoint.x);
        const y1 = Math.min(leftPinchPoint.y, rightPinchPoint.y);
        const x2 = Math.max(leftPinchPoint.x, rightPinchPoint.x);
        const y2 = Math.max(leftPinchPoint.y, rightPinchPoint.y);
        
        canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
    
    updateLightRect();
    
    canvasCtx.restore();
}

function resizeAllCanvases() {
    refreshLayoutMetrics();
    const rect = getContainerRect();
    
    canvasElement.width = rect.width;
    canvasElement.height = rect.height;
    
    drawingCanvas.width = rect.width;
    drawingCanvas.height = rect.height;
    drawingCtx.lineCap = 'round';
    drawingCtx.lineJoin = 'round';
    
    fireworkCanvas.width = rect.width;
    fireworkCanvas.height = rect.height;
}

async function initMediaPipe() {
    hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    
    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    
    hands.onResults(onResults);
    
    camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({image: videoElement});
        },
        width: 640,
        height: 480
    });
    
    await camera.start();
}

window.addEventListener('resize', () => {
    resizeAllCanvases();
});

function init() {
    refreshLayoutMetrics();
    resizeAllCanvases();
    initDrawingCanvas();
    initFireworkCanvas();
    initMediaPipe();
    updateFireworks();
    
    isFullBright = false;
    isInPinchMode = false;
    setOverlayDisplay('block');
    setLightRectDisplay('none');
}

window.addEventListener('load', init);
