const API_URL = 'http://localhost:8000';
const LOGIN_URL = 'http://localhost:5173/login';

function redirectToLogin() {
    const currentUrl = window.location.href;
    const loginUrl = `${LOGIN_URL}?redirect=${encodeURIComponent(currentUrl)}`;
    window.location.href = loginUrl;
}

function getToken() {
    let token = localStorage.getItem('token')
    if (!token) {
        const urlParams = new URLSearchParams(window.location.search);
        token = urlParams.get('token');

        if (token) {
            localStorage.setItem('token', token);
            window.history.replaceState({}, document.title, window.location.pathname);
            return token;
        } else {
            redirectToLogin();
            return null;
        }
    }
    return token;
}

const token = getToken();
if (!token) {
    throw new Error("Redirecting to login...");
}

const createButton = document.querySelector("#createroom");
const videoCont = document.querySelector('.video-self');
const codeCont = document.querySelector('#roomcode');
const joinBut = document.querySelector('#joinroom');
const mic = document.querySelector('#mic');
const cam = document.querySelector('#webcam');

let micAllowed = 1;
let camAllowed = 1;
let mediaConstraints = { video: true, audio: true };

navigator.mediaDevices.getUserMedia(mediaConstraints)
    .then(localstream => {
        videoCont.srcObject = localstream;
    })
    .catch(err => {
        console.error('Camera error:', err);
    });


// Tạo nút scheduled meeting
const scheduledBtn = document.createElement('button');
scheduledBtn.innerHTML = 'Lên lịch họp';
scheduledBtn.className = 'createroom-butt unselectable';

// Style cơ bản
scheduledBtn.style.marginTop = '10px';
scheduledBtn.style.padding = '8px 16px'; // Thêm padding cho cân đối
scheduledBtn.style.cursor = 'pointer';
scheduledBtn.style.borderRadius = '8px'; // Bo góc nhẹ cho hiện đại
scheduledBtn.style.transition = 'all 0.3s ease'; // Hiệu ứng chuyển cảnh mượt mà
scheduledBtn.style.outline = 'none';

// Màu sắc theo yêu cầu
scheduledBtn.style.background = 'transparent';
scheduledBtn.style.border = '2px solid #323cae';
scheduledBtn.style.color = '#000000';
scheduledBtn.style.fontWeight = '500';

// --- HIỆU ỨNG HOVER (Di chuột vào) ---
scheduledBtn.onmouseenter = () => {
    // Nền chuyển sang màu xanh rất nhạt để không làm chìm chữ đen
    scheduledBtn.style.background = 'rgba(50, 60, 174, 0.1)';
};

scheduledBtn.onmouseleave = () => {
    scheduledBtn.style.background = 'transparent';
};

// --- HIỆU ỨNG ACTIVE (Khi nhấn giữ) ---
scheduledBtn.onmousedown = () => {
    scheduledBtn.style.transform = 'scale(0.95)'; // Nút thu nhỏ lại một chút khi nhấn
    scheduledBtn.style.background = 'rgba(50, 60, 174, 0.2)';
};

scheduledBtn.onmouseup = () => {
    scheduledBtn.style.transform = 'scale(1)'; // Trở về kích thước cũ
};

createButton.parentNode.insertBefore(scheduledBtn, createButton.nextSibling);


createButton.addEventListener('click', async (e) => {
    e.preventDefault();

    let token = getToken();
    if (!token) return;

    createButton.disabled = true;
    createButton.innerHTML = 'Creating Room...';

    try {
        const response = await fetch(`${API_URL}/meetings/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                room_type: 'instant',
                title: 'Cuộc họp nhanh'
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                localStorage.removeItem('token');
                redirectToLogin(); // 🔥 auto login lại
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        location.href = `/room.html?room=${data.room_id}`;

    } catch (err) {
        console.error(err);
        alert('Lỗi tạo room: ' + err.message);
        createButton.disabled = false;
        createButton.innerHTML = 'Tạo phòng';
    }
});

// Tạo scheduled meeting
scheduledBtn.addEventListener('click', async () => {
    let token = getToken();
    if (!token) return;

    const title = prompt('Tên cuộc họp:', 'Cuộc họp dài hạn');
    if (!title) return;

    const dateStr = prompt('Ngày họp (YYYY-MM-DD):', '2026-04-01');
    const timeStr = prompt('Giờ họp (HH:MM):', '14:00');

    if (!dateStr || !timeStr) return;

    const scheduled_at = new Date(`${dateStr}T${timeStr}:00`).toISOString();
    const requireApproval = confirm('Có yêu cầu host duyệt khi vào không?');

    try {
        const response = await fetch(`${API_URL}/meetings/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                room_type: 'scheduled',
                title: title,
                scheduled_at: scheduled_at,
                settings: {
                    require_approval: requireApproval,
                    allow_chat_files: true
                }
            })
        });

        const data = await response.json();

        if (response.ok) {
            navigator.clipboard.writeText(data.room_id);
            alert(`✅ Đã tạo cuộc họp!\n\nMã phòng: ${data.room_id}\nThời gian: ${dateStr} ${timeStr}\n\nMã đã được copy.`);
        } else {
            alert('Lỗi: ' + (data.detail || 'Không thể tạo'));
        }

    } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
    }
});


joinBut.addEventListener('click', (e) => {
    e.preventDefault();

    if (codeCont.value.trim() == "") {
        codeCont.classList.add('roomcode-error');
        return;
    }

    location.href = `/room.html?room=${codeCont.value}`;
});

codeCont.addEventListener('change', () => {
    if (codeCont.value.trim() !== "") {
        codeCont.classList.remove('roomcode-error');
    }
});


// ====== CAMERA ======
cam.addEventListener('click', () => {
    if (camAllowed) {
        mediaConstraints = { video: false, audio: micAllowed ? true : false };
        cam.classList = "nodevice";
        cam.innerHTML = `<i class="fas fa-video-slash"></i>`;
        camAllowed = 0;
    } else {
        mediaConstraints = { video: true, audio: micAllowed ? true : false };
        cam.classList = "device";
        cam.innerHTML = `<i class="fas fa-video"></i>`;
        camAllowed = 1;
    }

    navigator.mediaDevices.getUserMedia(mediaConstraints)
        .then(localstream => { videoCont.srcObject = localstream; });
});


// ====== MIC ======
mic.addEventListener('click', () => {
    if (micAllowed) {
        mediaConstraints = { video: camAllowed ? true : false, audio: false };
        mic.classList = "nodevice";
        mic.innerHTML = `<i class="fas fa-microphone-slash"></i>`;
        micAllowed = 0;
    } else {
        mediaConstraints = { video: camAllowed ? true : false, audio: true };
        mic.classList = "device";
        mic.innerHTML = `<i class="fas fa-microphone"></i>`;
        micAllowed = 1;
    }

    navigator.mediaDevices.getUserMedia(mediaConstraints)
        .then(localstream => { videoCont.srcObject = localstream; });
});