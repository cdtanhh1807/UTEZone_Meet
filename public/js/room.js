const API_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000';
const token = localStorage.getItem('token') || localStorage.getItem('utezone_token');

if (!token) {
    alert('Vui lòng đăng nhập UTEZone trước!');
    location.href = '/';
}

const myvideo = document.querySelector("#vd1");
const roomid = new URLSearchParams(location.search).get("room");
let userEmail = '';
let userFullName = '';
let displayName = '';

const participantInfo = {};

const chatRoom = document.querySelector('.chat-cont');
const sendButton = document.querySelector('.chat-send');
const messageField = document.querySelector('.chat-input');
const videoContainer = document.querySelector('#vcont');
const overlayContainer = document.querySelector('#overlay');
const videoButt = document.querySelector('.novideo');
const audioButt = document.querySelector('.audio');
const cutCall = document.querySelector('.cutcall');
const screenShareButt = document.querySelector('.screenshare');
const whiteboardButt = document.querySelector('.board-icon');
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

const whiteboardCont = document.querySelector('.whiteboard-cont');
const canvas = document.querySelector("#whiteboard");
const ctx = canvas.getContext('2d');


//===============================Direc bên chatroom
let channelId = new URLSearchParams(location.search).get("channel");
let chatroomId = new URLSearchParams(location.search).get("chatroom");

// Nếu URL thiếu, lấy từ sessionStorage (đã lưu từ channel.js)
if (!channelId) channelId = sessionStorage.getItem('lastVoiceChannel');
if (!chatroomId) chatroomId = sessionStorage.getItem('lastVoiceRoom');

console.log('[room.js] Redirect params:', { channelId, chatroomId });
//===============================


let micAllowed = 1;
let camAllowed = 1;
let videoAllowed = 1;
let audioAllowed = 1;
let screenshareEnabled = false;
let boardVisisble = false;
let mystream = null;
let myCameraStream = null;
let myScreenTrack = null;
const peers = {};
const pendingScreenSharePeers = new Set(); // track peers awaiting answer after screen share renegotiate

const activeScreenShares = {};
let viewingScreenShare = null;
let isHost = false;
let roomType = 'instant';
let ws = null;

const configuration = {
    iceServers: [
        { urls: "stun:stun.stunprotocol.org" },
        {
            urls: "turn:free.expressturn.com:3478",
            username: "000000002088417456",
            credential: "mQ8fl4xHNJqiU5d9DhQSBPRuu0M="
        }
    ]
};

let isDrawing = 0;
let x = 0;
let y = 0;
let color = "black";
let drawsize = 3;

async function getUserInfo() {
    try {
        showLoadingOverlay();
        const tokenPayload = JSON.parse(atob(token.split('.')[1]));
        userEmail = tokenPayload.sub;

        const response = await fetch(`${API_URL}/account/account_info?email=${userEmail}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Failed to get user info');

        const data = await response.json();
        userFullName = data.fullName || userEmail.split('@')[0];
        displayName = userFullName ? `${userFullName} (${userEmail})` : userEmail;

        participantInfo[userEmail] = {
            fullName: userFullName,
            displayName: displayName
        };

        hideLoadingOverlay();
        initWebSocket();

    } catch (err) {
        console.error('Error getting user info:', err);
        const tokenPayload = JSON.parse(atob(token.split('.')[1]));
        userEmail = tokenPayload.sub;
        userFullName = userEmail.split('@')[0];
        displayName = userEmail;

        participantInfo[userEmail] = {
            fullName: userFullName,
            displayName: displayName
        };

        hideLoadingOverlay();
        initWebSocket();
    }
}

function showLoadingOverlay() {
    let loadingOverlay = document.getElementById('loading-overlay');
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loading-overlay';
        loadingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            color: white;
            font-family: sans-serif;
        `;
        loadingOverlay.innerHTML = `
            <div style="font-size: 28px; margin-bottom: 20px; font-weight: bold;">UTEZone Meeting</div>
            <div style="font-size: 16px; margin-bottom: 30px; opacity: 0.9;">Đang chuẩn bị tham gia cuộc họp...</div>
            <div class="spinner" style="
                width: 50px;
                height: 50px;
                border: 4px solid rgba(255,255,255,0.3);
                border-top: 4px solid #323cae;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        document.body.appendChild(loadingOverlay);
    } else {
        loadingOverlay.style.display = 'flex';
    }

    if (overlayContainer) {
        overlayContainer.style.display = 'none';
    }
}

function hideLoadingOverlay() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

function initWebSocket() {
    document.querySelector("#myname").innerHTML = `${displayName} (Bạn)`;

    ws = new WebSocket(`${WS_URL}/ws/meeting/${roomid}?token=${token}`);

    ws.onopen = () => console.log('Connected to meeting server');

    ws.onclose = () => {
        console.log('Disconnected');
        // location.href = '/';
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Lỗi kết nối');
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'joined_room':
                handleJoinedRoom(data);
                loadChatHistory();
                break;
            case 'user_joined':
                handleUserJoined(data);
                break;
            case 'user_left':
                handleUserLeft(data);
                break;
            case 'offer':
                handleOffer(data);
                break;
            case 'answer':
                handleAnswer(data);
                break;
            case 'ice_candidate':
                handleICECandidate(data);
                break;
            case 'media_toggle':
                handleRemoteMediaToggle(data);
                break;
            case 'screen_share_started':
                console.log('[WS] screen_share_started received, full data:', JSON.stringify(data));
                handleRemoteScreenShareStarted(data);
                break;
            case 'screen_share_stopped':
                handleRemoteScreenShareStopped(data);
                break;
            case 'stop_all_screenshares':
                // Host gửi lệnh dừng tất cả đến server
                // Server sẽ forward đến tất cả clients đang share
                console.log('[WS] stop_all_screenshares received');
                break;
            case 'force_stop_screenshare':
                // Nhận lệnh từ host, dừng share màn hình nếu đang share
                console.log('[WS] force_stop_screenshare received');
                if (screenshareEnabled) {
                    stopScreenShare();
                }
                break;
            case 'chat':
                if (data.sender_email !== userEmail) {
                    displayMessage(data);
                }
                break;
            case 'whiteboard_draw':
                drawRemote(data.data);
                break;
            case 'whiteboard_clear':
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                break;
            case 'room_ended':
                alert(`Host đã kết thúc cuộc họp.\nĐã xóa ${data.deleted_files || 0} file.`);
                // location.href = '/';
                const savedChannel = sessionStorage.getItem('lastVoiceChannel');
                const savedChatroom = sessionStorage.getItem('lastVoiceRoom');
                if (savedChannel && savedChatroom) {
                    location.href = `/channel.html?channel=${savedChannel}&chatroom=${savedChatroom}&return=1`;
                } else {
                    location.href = '/';
                }
                break;
            case 'error':
                alert(data.message);
                break;
        }
    };
}

async function createPeerConnection(targetEmail, isInitiator) {
    if (peers[targetEmail]) return peers[targetEmail];

    const pc = new RTCPeerConnection(configuration);
    peers[targetEmail] = pc;

    if (mystream) {
        mystream.getTracks().forEach(track => pc.addTrack(track, mystream));
    }

    // QUAN TRỌNG: Lưu trữ stream hiện tại để so sánh
    let lastStreamId = null;

    pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;

        console.log(`[ontrack] from=${targetEmail} streamId=${stream.id} trackId=${event.track.id} kind=${event.track.kind}`);

        if (stream.id !== lastStreamId) {
            lastStreamId = stream.id;
            const existingContainer = document.getElementById(`video-${targetEmail}`);
            if (existingContainer) {
                const video = existingContainer.querySelector('video');
                if (video) { video.srcObject = null; video.srcObject = stream; }
            } else {
                createRemoteVideoElement(targetEmail, stream);
            }
        }
    };

    // Khi track thay đổi (replaceTrack), trigger re-offer để remote nhận ontrack mới
    pc.onnegotiationneeded = async () => {
        console.log(`[negotiationneeded] ${targetEmail}`);
        if (!isInitiator) return; // Chỉ initiator mới tạo offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'offer', target: targetEmail, offer }));
            console.log(`[Renegotiate] Sent new offer to ${targetEmail}`);
        } catch (e) {
            console.error('[Renegotiate] Error:', e);
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice_candidate',
                target: targetEmail,
                candidate: event.candidate
            }));
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            startScreenShareMonitor(targetEmail, pc);
        }
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            removeRemoteVideo(targetEmail);
        }
    };

    if (isInitiator) {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'offer', target: targetEmail, offer }));
        } catch (e) {
            console.error('Error creating offer:', e);
        }
    }

    return pc;
}

async function handleOffer(data) {
    const pc = await createPeerConnection(data.from, false);
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', target: data.from, answer }));
    } catch (e) {
        console.error('Error handling offer:', e);
    }
}

async function handleAnswer(data) {
    const pc = peers[data.from];
    if (pc) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log(`[handleAnswer] from=${data.from}`);

            // Kiểm tra nếu đây là answer sau screen share renegotiation
            if (pendingScreenSharePeers.has(data.from)) {
                pendingScreenSharePeers.delete(data.from);
                console.log(`[ScreenShare] Got answer from ${data.from}, pending=${pendingScreenSharePeers.size}`);

                // Gửi signal sau khi TẤT CẢ peers đã trả lời
                if (pendingScreenSharePeers.size === 0 && screenshareEnabled) {
                    console.log('[ScreenShare] All peers answered, sending screen_share_started signal');
                    ws.send(JSON.stringify({ type: 'screen_share_started', sender_email: userEmail }));
                }
            }
        } catch (e) {
            console.error('Error handling answer:', e);
        }
    }
}

async function handleICECandidate(data) {
    const pc = peers[data.from];
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            console.error('Error adding ICE candidate:', e);
        }
    }
}

function updateVideoNameTag(email) {
    const container = document.getElementById(`video-${email}`);
    if (!container) return;
    const nameTag = container.querySelector('.nametag');
    const info = participantInfo[email];
    if (nameTag && info) {
        nameTag.innerHTML = info.displayName;
    }
}

function createRemoteVideoElement(email, stream) {
    let info = participantInfo[email];
    let displayText = info ? info.displayName : email;

    const vidCont = document.createElement('div');
    vidCont.id = `video-${email}`;
    vidCont.className = 'video-box';

    const newvideo = document.createElement('video');
    newvideo.className = 'video-frame';
    newvideo.autoplay = true;
    newvideo.playsinline = true;
    newvideo.srcObject = stream;

    const nameTag = document.createElement('div');
    nameTag.className = 'nametag';
    nameTag.innerHTML = displayText;

    const muteIcon = document.createElement('div');
    muteIcon.className = 'mute-icon';
    muteIcon.id = `mute-${email}`;
    muteIcon.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    muteIcon.style.visibility = 'hidden';

    const videoOff = document.createElement('div');
    videoOff.className = 'video-off';
    videoOff.id = `vidoff-${email}`;
    videoOff.innerHTML = 'Video Off';
    videoOff.style.visibility = 'hidden';

    vidCont.appendChild(newvideo);
    vidCont.appendChild(nameTag);
    vidCont.appendChild(muteIcon);
    vidCont.appendChild(videoOff);

    videoContainer.appendChild(vidCont);

    setTimeout(() => updateVideoNameTag(email), 100);
    updateVideoLayoutByUserCount();
}

function removeRemoteVideo(email) {
    const elem = document.getElementById(`video-${email}`);
    if (elem) elem.remove();
    if (peers[email]) {
        peers[email].close();
        delete peers[email];
    }
    delete participantInfo[email];
    removeScreenShare(email);
    updateVideoLayoutByUserCount();
}

function updateVideoLayout() {
    const count = document.querySelectorAll('.video-box').length;

    // Chỉ thay đổi class, không thay đổi style inline
    if (count > 1) {
        videoContainer.classList.remove('video-cont-single');
        videoContainer.classList.add('video-cont');
    } else {
        videoContainer.classList.remove('video-cont');
        videoContainer.classList.add('video-cont-single');
    }

    // Reset any inline styles that might affect layout
    videoContainer.style.cssText = '';
    videoContainer.style.flex = '1';
    videoContainer.style.minHeight = '0';
    videoContainer.style.overflowY = 'auto';
}

// =================== SCREEN SHARE UI ===================

function getScreenShareContainer() {
    let cont = document.getElementById('screenshare-main');
    if (!cont) {
        cont = document.createElement('div');
        cont.id = 'screenshare-main';
        cont.style.cssText = `
            position: relative;
            width: 100%;
            height: calc(100vh - 220px);
            min-height: 300px;
            max-height: calc(100vh - 220px);
            background: #111;
            border-radius: 8px;
            overflow: hidden;
            flex-shrink: 0;
            margin-bottom: 10px;
            display: none;
        `;

        const video = document.createElement('video');
        video.id = 'screenshare-video';
        video.autoplay = true;
        video.playsinline = true;
        video.muted = false;
        video.style.cssText = `
            position: absolute;
            top: 0; left: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #111;
        `;

        const label = document.createElement('div');
        label.id = 'screenshare-label';
        label.style.cssText = `
            position: absolute;
            bottom: 10px;
            left: 12px;
            background: rgba(0,0,0,0.7);
            color: #fff;
            font-size: 14px;
            padding: 6px 12px;
            border-radius: 20px;
            z-index: 10;
            font-weight: 500;
        `;

        cont.appendChild(video);
        cont.appendChild(label);

        const leftCont = document.querySelector('.left-cont');
        // Chèn vào trước videoContainer, không phải trước footer
        leftCont.insertBefore(cont, videoContainer);
    }
    return cont;
}

function showScreenShareMain(stream, name) {
    const cont = getScreenShareContainer();
    cont.style.display = 'block';

    const video = document.getElementById('screenshare-video');
    video.srcObject = stream;
    video.play().catch(console.warn);

    document.getElementById('screenshare-label').textContent = `🖥️ ${name} đang chia sẻ màn hình`;

    const userCount = document.querySelectorAll('.video-box').length;

    if (userCount <= 2) {
        cont.style.maxHeight = '55vh';
        cont.style.minHeight = '250px';
    } else if (userCount <= 6) {
        cont.style.maxHeight = '45vh';
        cont.style.minHeight = '200px';
    } else {
        cont.style.maxHeight = '35vh';
        cont.style.minHeight = '160px';
    }

    cont.style.flexShrink = '0';

    videoContainer.style.overflowY = 'auto';
    videoContainer.style.flex = '1';
    videoContainer.style.minHeight = '0';
    videoContainer.style.marginTop = '12px';

    document.querySelectorAll('.video-box').forEach(box => {
        box.style.cssText = '';
        const vid = box.querySelector('video');
        if (vid) {
            vid.style.cssText = '';
        }
    });

    if (userCount > 1) {
        videoContainer.classList.remove('video-cont-single');
        videoContainer.classList.add('video-cont');
    } else {
        videoContainer.classList.remove('video-cont');
        videoContainer.classList.add('video-cont-single');
    }

    ensureFooterVisible();
}

function ensureFooterVisible() {
    const footer = document.querySelector('.footer');
    if (footer) {
        footer.style.cssText = '';
        footer.style.display = 'flex';
        footer.style.visibility = 'visible';
        footer.style.position = 'relative';
        footer.style.marginTop = 'auto';
        footer.style.flexShrink = '0';
        footer.style.zIndex = '100';
    }

    const copycodeCont = document.querySelector('.copycode-cont');
    if (copycodeCont) {
        copycodeCont.style.cssText = '';
        copycodeCont.style.display = 'flex';
        copycodeCont.style.visibility = 'visible';
        copycodeCont.style.position = 'absolute';
        copycodeCont.style.left = '0';
        copycodeCont.style.top = '50%';
        copycodeCont.style.transform = 'translateY(-50%)';
    }
}

function hideScreenShareMain() {
    const cont = document.getElementById('screenshare-main');
    if (cont) cont.style.display = 'none';

    const selector = document.getElementById('screenshare-selector');
    if (selector) selector.remove();

    videoContainer.style.cssText = '';
    videoContainer.style.flex = '1';
    videoContainer.style.minHeight = '0';
    videoContainer.style.overflowY = 'auto';

    const count = document.querySelectorAll('.video-box').length;
    if (count > 1) {
        videoContainer.classList.remove('video-cont-single');
        videoContainer.classList.add('video-cont');
    } else {
        videoContainer.classList.remove('video-cont');
        videoContainer.classList.add('video-cont-single');
    }

    document.querySelectorAll('.video-box').forEach(box => {
        box.style.cssText = '';
        const vid = box.querySelector('video');
        if (vid) vid.style.cssText = '';
    });

    updateVideoLayoutByUserCount();

    const footer = document.querySelector('.footer');
    if (footer) {
        footer.style.cssText = '';
        footer.style.display = 'flex';
        footer.style.visibility = 'visible';
    }

    const copycodeCont = document.querySelector('.copycode-cont');
    if (copycodeCont) {
        copycodeCont.style.cssText = '';
        copycodeCont.style.display = 'flex';
        copycodeCont.style.visibility = 'visible';
    }
}

function updateVideoLayoutByUserCount() {
    const count = document.querySelectorAll('.video-box').length;

    if (count > 1) {
        videoContainer.classList.remove('video-cont-single');
        videoContainer.classList.add('video-cont');
    } else {
        videoContainer.classList.remove('video-cont');
        videoContainer.classList.add('video-cont-single');
    }

    const userCountClasses = ['user-count-1', 'user-count-2', 'user-count-3', 'user-count-4',
        'user-count-5', 'user-count-6', 'user-count-7', 'user-count-8',
        'user-count-9', 'user-count-10', 'user-count-11', 'user-count-12',
        'user-count-13'];
    userCountClasses.forEach(className => {
        videoContainer.classList.remove(className);
    });

    if (count <= 4) {
        videoContainer.classList.add(`user-count-${count}`);
    } else if (count <= 8) {
        videoContainer.classList.add(`user-count-${Math.ceil(count / 2) * 2}`);
    } else if (count <= 12) {
        videoContainer.classList.add(`user-count-${Math.ceil(count / 3) * 3}`);
    } else {
        videoContainer.classList.add('user-count-13');
    }

    videoContainer.style.cssText = '';
    videoContainer.style.flex = '1';
    videoContainer.style.minHeight = '0';
    videoContainer.style.overflowY = 'auto';
}

function updateScreenShareSelector() {
    const oldSel = document.getElementById('screenshare-selector');
    if (oldSel) oldSel.remove();

    const sharers = Object.keys(activeScreenShares);
    if (sharers.length === 0) return;

    sharers.forEach(email => {
        if (email === userEmail) return;
        const videoBox = document.getElementById(`video-${email}`);
        const vid = videoBox?.querySelector('video');
        if (vid?.srcObject) {
            activeScreenShares[email].stream = vid.srcObject;
        }
    });

    const selector = document.createElement('div');
    selector.id = 'screenshare-selector';
    selector.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3a 100%);
        border-radius: 12px;
        margin-bottom: 12px;
        flex-wrap: wrap;
        flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;

    selector.innerHTML = `
        <span style="color:#aaa;font-size:13px;font-weight:500;white-space:nowrap;">
            🖥️ Đang chia sẻ (${sharers.length}):
        </span>
    `;

    sharers.forEach(email => {
        const info = activeScreenShares[email];
        const name = info?.name || email;
        const shortName = name.length > 25 ? name.substring(0, 22) + '...' : name;
        const isActive = email === viewingScreenShare;
        const isMe = email === userEmail;

        const btn = document.createElement('button');
        btn.innerHTML = `${isMe ? '👤 ' : ''}${shortName} ${isActive ? '✓' : ''}`;
        btn.style.cssText = `
            padding: 6px 16px;
            border-radius: 24px;
            border: none;
            background: ${isActive ? '#4f8ef7' : '#3a3a4a'};
            color: #fff;
            font-size: 12px;
            font-weight: ${isActive ? '600' : '400'};
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            box-shadow: ${isActive ? '0 2px 8px rgba(79,142,247,0.3)' : 'none'};
        `;

        btn.onmouseenter = () => {
            if (!isActive) btn.style.background = '#4a4a5a';
        };
        btn.onmouseleave = () => {
            if (!isActive) btn.style.background = '#3a3a4a';
        };

        btn.addEventListener('click', () => {
            viewingScreenShare = email;
            const stream = activeScreenShares[email]?.stream;
            if (stream) {
                showScreenShareMain(stream, name);
            }
            updateScreenShareSelector();
        });
        selector.appendChild(btn);
    });

    // Nút dừng tất cả - chỉ host mới thấy
    // if (isHost && sharers.length > 0) {
    //     const stopAllBtn = document.createElement('button');
    //     stopAllBtn.innerHTML = '🛑 Dừng tất cả';
    //     stopAllBtn.style.cssText = `
    //         padding: 6px 14px;
    //         border-radius: 24px;
    //         border: 1px solid #e74c3c;
    //         background: transparent;
    //         color: #e74c3c;
    //         font-size: 12px;
    //         cursor: pointer;
    //         transition: all 0.2s;
    //         margin-left: auto;
    //     `;
    //     stopAllBtn.onmouseenter = () => {
    //         stopAllBtn.style.background = '#e74c3c';
    //         stopAllBtn.style.color = '#fff';
    //     };
    //     stopAllBtn.onmouseleave = () => {
    //         stopAllBtn.style.background = 'transparent';
    //         stopAllBtn.style.color = '#e74c3c';
    //     };
    //     stopAllBtn.addEventListener('click', () => {
    //         if (confirm('Dừng tất cả màn hình đang chia sẻ?')) {
    //             // Gửi lệnh dừng trực tiếp đến từng user đang share (không qua server)
    //             Object.keys(activeScreenShares).forEach(email => {
    //                 if (email !== userEmail) {
    //                     // Gửi trực tiếp qua WebSocket đến user đó
    //                     ws.send(JSON.stringify({
    //                         type: 'force_stop_screenshare',
    //                         target: email
    //                     }));
    //                 }
    //             });

    //             // Nếu chính host đang share thì cũng dừng
    //             if (screenshareEnabled) {
    //                 stopScreenShare();
    //             }

    //             // Hiển thị thông báo
    //             chatRoom.innerHTML += `
    //         <div class="message system" style="text-align:center;color:#e74c3c;font-style:italic;">
    //             <small>👑 Host đã dừng tất cả màn hình đang chia sẻ</small>
    //         </div>
    //     `;
    //             chatRoom.scrollTop = chatRoom.scrollHeight;
    //         }
    //     });
    //     selector.appendChild(stopAllBtn);
    // }

    const cont = document.getElementById('screenshare-main');
    if (cont?.parentNode) {
        const existingSelector = cont.parentNode.querySelector('#screenshare-selector');
        if (existingSelector) existingSelector.remove();
        cont.parentNode.insertBefore(selector, cont);
    }
}

// =================== SCREEN SHARE DETECTION ===================

function checkAndShowScreenShare(email, stream) {
    if (!stream) return false;

    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) return false;

    const settings = videoTracks[0].getSettings();
    const width = settings.width || 0;
    const height = settings.height || 0;
    const audioTracks = stream.getAudioTracks();

    console.log(`[Check Screen] ${email}: ${width}x${height}, audio=${audioTracks.length}, enabled=${videoTracks[0].enabled}, readyState=${videoTracks[0].readyState}`);

    // Screen share detection: resolution lớn hoặc không có audio
    // HOẶC: track label chứa "screen" hoặc "display"
    const trackLabel = videoTracks[0].label.toLowerCase();
    const isScreenByLabel = trackLabel.includes('screen') || trackLabel.includes('display') || trackLabel.includes('window');
    const isScreenByRes = width > 1000 || height > 1000;
    const isScreenByAudio = audioTracks.length === 0;

    const isScreenShare = isScreenByLabel || isScreenByRes || isScreenByAudio;

    console.log(`[Screen Check] ${email}: labelMatch=${isScreenByLabel}, resMatch=${isScreenByRes}, audioMatch=${isScreenByAudio}, result=${isScreenShare}`);

    if (isScreenShare && !activeScreenShares[email]) {
        console.log(`[Screen Detected] ${email}`);

        const name = participantInfo[email]?.displayName || email;
        activeScreenShares[email] = { name };
        viewingScreenShare = email;

        // Ẩn video box gốc
        const videoBox = document.getElementById(`video-${email}`);
        if (videoBox) videoBox.style.display = 'none';

        // Hiển thị ở vùng chính
        showScreenShareMain(stream, name);
        updateScreenShareSelector();

        return true;
    }

    return false;
}

// Monitor peer connection bằng getStats để detect khi frame size thay đổi (screen share)
const screenShareMonitors = {};

function startScreenShareMonitor(email, pc) {
    if (screenShareMonitors[email]) return; // đã chạy rồi

    let lastWidth = 0;
    let lastHeight = 0;
    let consecutiveScreenFrames = 0;
    let consecutiveCameraFrames = 0;
    const THRESHOLD = 3; // số lần liên tiếp phải confirm

    console.log(`[Monitor] Started for ${email}`);

    const intervalId = setInterval(async () => {
        if (!peers[email]) {
            clearInterval(intervalId);
            delete screenShareMonitors[email];
            return;
        }

        try {
            const stats = await pc.getStats();
            let frameWidth = 0, frameHeight = 0;

            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                    frameWidth = report.frameWidth || 0;
                    frameHeight = report.frameHeight || 0;
                }
            });

            if (frameWidth === 0) return; // chưa có frame

            const isScreenRes = frameWidth > 900 || frameHeight > 900;
            const wasScreen = !!activeScreenShares[email];

            if (frameWidth !== lastWidth || frameHeight !== lastHeight) {
                console.log(`[Monitor] ${email} resolution changed: ${lastWidth}x${lastHeight} -> ${frameWidth}x${frameHeight}, isScreenRes=${isScreenRes}`);
                lastWidth = frameWidth;
                lastHeight = frameHeight;
                consecutiveScreenFrames = 0;
                consecutiveCameraFrames = 0;
            }

            if (isScreenRes) {
                consecutiveCameraFrames = 0;
                consecutiveScreenFrames++;
                if (consecutiveScreenFrames >= THRESHOLD && !wasScreen) {
                    console.log(`[Monitor] ${email} => SCREEN SHARE detected (${frameWidth}x${frameHeight})`);
                    const name = participantInfo[email]?.displayName || email;
                    const videoBox = document.getElementById(`video-${email}`);
                    const vid = videoBox?.querySelector('video');
                    const stream = vid?.srcObject || null;
                    activeScreenShares[email] = { name, stream };

                    // Chỉ auto-switch nếu chưa có ai đang được xem
                    if (!viewingScreenShare) {
                        viewingScreenShare = email;
                        if (videoBox) videoBox.style.display = 'none';
                        if (stream) showScreenShareMain(stream, name);
                    }
                    updateScreenShareSelector();
                }
            } else {
                consecutiveScreenFrames = 0;
                consecutiveCameraFrames++;
                if (consecutiveCameraFrames >= THRESHOLD && wasScreen) {
                    console.log(`[Monitor] ${email} => CAMERA restored (${frameWidth}x${frameHeight})`);
                    delete activeScreenShares[email];
                    const videoBox2 = document.getElementById(`video-${email}`);
                    if (videoBox2) videoBox2.style.display = '';

                    if (viewingScreenShare === email) {
                        const remaining = Object.keys(activeScreenShares);
                        if (remaining.length > 0) {
                            // Tự động chuyển sang màn hình khác còn đang share
                            viewingScreenShare = remaining[0];
                            const nextStream = activeScreenShares[remaining[0]]?.stream;
                            if (nextStream) showScreenShareMain(nextStream, activeScreenShares[remaining[0]].name);
                        } else {
                            viewingScreenShare = null;
                            hideScreenShareMain();
                        }
                    }
                    updateScreenShareSelector();
                    updateVideoLayout();
                }
            }
        } catch (e) {
            // pc đã đóng
            clearInterval(intervalId);
            delete screenShareMonitors[email];
        }
    }, 500);

    screenShareMonitors[email] = intervalId;
}

// =================== REMOTE SCREEN SHARE HANDLING ===================

function handleRemoteScreenShareStarted(data) {
    const email = data.sender_email || data.email || data.from;
    console.log('[Remote] Screen share started from:', email, 'active shares:', Object.keys(activeScreenShares).length);

    if (!email) {
        console.error('[Remote] Cannot determine sender email from:', JSON.stringify(data));
        return;
    }

    const name = participantInfo[email]?.displayName || email;

    activeScreenShares[email] = {
        name: name,
        startedAt: Date.now()
    };

    if (!viewingScreenShare || !activeScreenShares[viewingScreenShare]) {
        viewingScreenShare = email;
    }

    function tryShowFromVideoElement() {
        const videoBox = document.getElementById(`video-${email}`);
        if (!videoBox) return false;
        const vid = videoBox.querySelector('video');
        if (!vid || !vid.srcObject) return false;

        console.log(`[Remote] Taking stream from video element for ${email}`);

        activeScreenShares[email].stream = vid.srcObject;
        videoBox.style.display = 'none';

        if (viewingScreenShare === email) {
            showScreenShareMain(vid.srcObject, name);
        }

        updateScreenShareSelector();
        return true;
    }

    if (tryShowFromVideoElement()) return;

    let checks = 0;
    const interval = setInterval(() => {
        if (tryShowFromVideoElement()) {
            clearInterval(interval);
            return;
        }
        if (++checks >= 50) {
            clearInterval(interval);
            console.warn(`[Remote] Timeout: no stream for ${email}`);
        }
    }, 100);

    chatRoom.innerHTML += `
        <div class="message system" style="text-align:center;color:#4caf50;font-style:italic;">
            <small>🖥️ ${name} đang chia sẻ màn hình</small>
        </div>
    `;
    chatRoom.scrollTop = chatRoom.scrollHeight;
}

function handleRemoteScreenShareStopped(data) {
    const email = data.sender_email;
    console.log('[Remote] Screen share stopped from:', email);
    if (!email) return;

    const name = participantInfo[email]?.displayName || email;

    delete activeScreenShares[email];

    const videoBox = document.getElementById(`video-${email}`);
    if (videoBox) {
        videoBox.style.display = '';
        const video = videoBox.querySelector('video');
        if (video) {
            const pc = peers[email];
            if (pc) {
                const receivers = pc.getReceivers();
                const videoReceiver = receivers.find(r => r.track?.kind === 'video');
                const audioReceiver = receivers.find(r => r.track?.kind === 'audio');
                if (videoReceiver?.track) {
                    const cameraStream = new MediaStream([videoReceiver.track]);
                    if (audioReceiver?.track) cameraStream.addTrack(audioReceiver.track);
                    video.srcObject = cameraStream;
                    video.play().catch(console.warn);
                }
            }
        }
    }

    if (viewingScreenShare === email) {
        const remaining = Object.keys(activeScreenShares);
        if (remaining.length === 0) {
            viewingScreenShare = null;
            hideScreenShareMain();
        } else {
            viewingScreenShare = remaining[0];
            const nextStream = activeScreenShares[remaining[0]]?.stream;
            if (nextStream) {
                const nextName = activeScreenShares[remaining[0]].name;
                showScreenShareMain(nextStream, nextName);
            }
        }
    }

    updateScreenShareSelector();

    chatRoom.innerHTML += `
        <div class="message system" style="text-align:center;color:#666;font-style:italic;">
            <small>🖥️ ${name} đã dừng chia sẻ màn hình</small>
        </div>
    `;
    chatRoom.scrollTop = chatRoom.scrollHeight;
}

function handleJoinedRoom(data) {
    isHost = data.is_host;
    roomType = data.room_type || 'instant';

    const hostIcon = isHost ? '🔑 ' : '';
    document.querySelector("#myname").innerHTML = `${hostIcon}${displayName} (Bạn)`;

    if (isHost) {
        cutCall.innerHTML = '<i class="fas fa-phone-slash"></i><span class="tooltiptext">Kết thúc</span>';
    }

    if (data.scheduled_at && !isHost) {
        const startTime = new Date(data.scheduled_at);
        const now = new Date();
        if (startTime > now) {
            const diff = Math.ceil((startTime - now) / 60000);
            alert(`⏰ Cuộc họp sẽ bắt đầu sau ${diff} phút\n(${startTime.toLocaleString()})`);
        }
    }

    if (data.participants && data.participants.length > 0) {
        data.participants.forEach(p => {
            if (p.email && p.full_name) {
                participantInfo[p.email] = {
                    fullName: p.full_name,
                    displayName: `${p.full_name} (${p.email})`
                };
            }
        });

        data.participants.forEach(p => {
            createPeerConnection(p.email, true);
        });

        setTimeout(() => {
            data.participants.forEach(p => {
                updateVideoNameTag(p.email);
            });
            updateVideoLayoutByUserCount();
        }, 500);
    }

    if (data.whiteboard) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src = data.whiteboard;
    }

    const participantCount = data.participants ? data.participants.length : 0;
    if (participantCount > 0) {
        chatRoom.innerHTML += `
            <div class="message system" style="text-align:center;color:#4caf50;font-style:italic;margin:10px 0;">
                <small>Đã tham gia cuộc họp cùng ${participantCount} người khác</small>
            </div>
        `;
    }
}

function handleUserJoined(data) {
    if (data.email && data.full_name) {
        participantInfo[data.email] = {
            fullName: data.full_name,
            displayName: `${data.full_name} (${data.email})`
        };
    }

    createPeerConnection(data.email, false);
    setTimeout(() => updateVideoNameTag(data.email), 300);

    const displayText = data.full_name
        ? `${data.full_name} (${data.email})`
        : data.email;

    const currentCount = document.querySelectorAll('.video-box').length;

    chatRoom.innerHTML += `
        <div class="message system" style="text-align:center;color:#666;font-style:italic;">
            <small>${displayText} đã tham gia (${currentCount + 1} người đang online)</small>
        </div>
    `;
    chatRoom.scrollTop = chatRoom.scrollHeight;
}

function handleUserLeft(data) {
    removeRemoteVideo(data.email);

    const info = participantInfo[data.email];
    const displayText = info ? info.displayName : data.email;
    const currentCount = document.querySelectorAll('.video-box').length;

    chatRoom.innerHTML += `
        <div class="message system" style="text-align:center;color:#666;font-style:italic;">
            <small>👋 ${displayText} đã rời đi (${currentCount} người còn lại)</small>
        </div>
    `;
    chatRoom.scrollTop = chatRoom.scrollHeight;
}

function handleRemoteMediaToggle(data) {
    const muteIcon = document.getElementById(`mute-${data.email}`);
    const vidOff = document.getElementById(`vidoff-${data.email}`);
    if (muteIcon) muteIcon.style.visibility = data.audio ? 'hidden' : 'visible';
    if (vidOff) vidOff.style.visibility = data.video ? 'hidden' : 'visible';
}

async function loadChatHistory() {
    try {
        const response = await fetch(`${API_URL}/meetings/${roomid}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        data.messages.forEach(msg => {
            // Hiển thị tất cả tin nhắn (kể cả của mình) để người mới vào thấy lịch sử đầy đủ
            displayMessage({
                sender_email: msg.sender_email,
                sender_name: msg.sender_name,
                msg_type: msg.message_type,
                content: msg.content,
                file_url: msg.file_url,
                file_name: msg.file_name,
                timestamp: msg.created_at
            });
        });
    } catch (e) {
        console.error('Failed to load chat history:', e);
    }
}

function fitToContainer(canvas) {
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}

fitToContainer(canvas);
window.onresize = () => fitToContainer(canvas);

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        mystream = stream;
        myCameraStream = stream.clone();
        myvideo.srcObject = stream;
        myvideo.muted = true;

        // Tắt mic và camera mặc định
        mystream.getAudioTracks().forEach(track => track.enabled = false);
        mystream.getVideoTracks().forEach(track => track.enabled = false);
        audioAllowed = 0;
        videoAllowed = 0;
        // Cập nhật icon
        audioButt.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        audioButt.style.backgroundColor = "#b12c2c";
        videoButt.innerHTML = '<i class="fas fa-video-slash"></i>';
        videoButt.style.backgroundColor = "#b12c2c";
        document.querySelector("#mymuteicon").style.visibility = 'visible';
        document.querySelector("#myvideooff").style.visibility = 'visible';

        getUserInfo();
    })
    .catch(err => {
        console.error('Media error:', err);
        alert('Không thể truy cập camera/microphone');
        getUserInfo();
    });

document.querySelector('.roomcode').innerHTML = `${roomid}`;

function CopyClassText() {
    navigator.clipboard.writeText(roomid).then(() => {
        document.querySelector(".copycode-button").textContent = "Đã sao chép!";
        setTimeout(() => document.querySelector(".copycode-button").textContent = "Sao chép", 5000);
    });
}

// =================== CONTROLS ===================

videoButt.addEventListener('click', () => {
    if (videoAllowed) {
        if (mystream) mystream.getVideoTracks().forEach(t => t.enabled = false);
        Object.values(peers).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === "video");
            if (sender) sender.track.enabled = false;
        });
        videoButt.innerHTML = '<i class="fas fa-video-slash"></i>';
        videoButt.style.backgroundColor = "#b12c2c";
        document.querySelector("#myvideooff").style.visibility = 'visible';
        videoAllowed = 0;
        ws.send(JSON.stringify({ type: 'media_toggle', video: false }));
    } else {
        if (mystream) mystream.getVideoTracks().forEach(t => t.enabled = true);
        Object.values(peers).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === "video");
            if (sender) sender.track.enabled = true;
        });
        videoButt.innerHTML = '<i class="fas fa-video"></i>';
        videoButt.style.backgroundColor = "#323cae";
        document.querySelector("#myvideooff").style.visibility = 'hidden';
        videoAllowed = 1;
        ws.send(JSON.stringify({ type: 'media_toggle', video: true }));
    }
});

audioButt.addEventListener('click', () => {
    if (audioAllowed) {
        if (mystream) mystream.getAudioTracks().forEach(t => t.enabled = false);
        Object.values(peers).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === "audio");
            if (sender) sender.track.enabled = false;
        });
        audioButt.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        audioButt.style.backgroundColor = "#b12c2c";
        document.querySelector("#mymuteicon").style.visibility = 'visible';
        audioAllowed = 0;
        ws.send(JSON.stringify({ type: 'media_toggle', audio: false }));
    } else {
        if (mystream) mystream.getAudioTracks().forEach(t => t.enabled = true);
        Object.values(peers).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === "audio");
            if (sender) sender.track.enabled = true;
        });
        audioButt.innerHTML = '<i class="fas fa-microphone"></i>';
        audioButt.style.backgroundColor = "#323cae";
        document.querySelector("#mymuteicon").style.visibility = 'hidden';
        audioAllowed = 1;
        ws.send(JSON.stringify({ type: 'media_toggle', audio: true }));
    }
});

screenShareButt.addEventListener('click', () => screenShareToggle());

function screenShareToggle() {
    if (!screenshareEnabled) {
        let screenMediaPromise;
        if (navigator.getDisplayMedia) {
            screenMediaPromise = navigator.getDisplayMedia({ video: true });
        } else if (navigator.mediaDevices.getDisplayMedia) {
            screenMediaPromise = navigator.mediaDevices.getDisplayMedia({ video: true });
        } else {
            screenMediaPromise = navigator.mediaDevices.getUserMedia({ video: { mediaSource: "screen" } });
        }

        screenMediaPromise
            .then(async (screenStream) => {
                screenshareEnabled = true;
                myScreenTrack = screenStream.getVideoTracks()[0];

                // replaceTrack rồi renegotiate để remote nhận ontrack mới
                pendingScreenSharePeers.clear();
                const replacePromises = Object.entries(peers).map(async ([peerEmail, pc]) => {
                    const sender = pc.getSenders().find(s => s.track?.kind === "video");
                    if (sender) {
                        await sender.replaceTrack(myScreenTrack);
                        try {
                            const offer = await pc.createOffer();
                            await pc.setLocalDescription(offer);
                            pendingScreenSharePeers.add(peerEmail); // chờ answer từ peer này
                            ws.send(JSON.stringify({ type: 'offer', target: peerEmail, offer }));
                            console.log(`[ScreenShare] Renegotiated with ${peerEmail}`);
                        } catch (e) {
                            console.error(`[ScreenShare] Renegotiate error with ${peerEmail}:`, e);
                        }
                    }
                });
                await Promise.all(replacePromises);

                activeScreenShares[userEmail] = {
                    name: `${displayName} (Bạn)`,
                    stream: screenStream
                };
                if (!viewingScreenShare) viewingScreenShare = userEmail;
                if (viewingScreenShare === userEmail) showScreenShareMain(screenStream, `${displayName} (Bạn)`);
                const footer = document.querySelector('.footer');
                if (footer) {
                    footer.style.display = 'flex';
                    footer.style.visibility = 'visible';
                }
                updateScreenShareSelector();


                // Signal screen_share_started được gửi sau khi nhận answer (xem handleAnswer)
                // Nếu không có peer nào, gửi ngay
                if (pendingScreenSharePeers.size === 0) {
                    ws.send(JSON.stringify({ type: 'screen_share_started', sender_email: userEmail }));
                }

                screenShareButt.innerHTML = '<i class="fas fa-desktop" style="color:#e74c3c"></i><span class="tooltiptext">Dừng chia sẻ</span>';
                screenShareButt.style.backgroundColor = '#b12c2c';

                myScreenTrack.onended = () => {
                    if (screenshareEnabled) stopScreenShare();
                };
            })
            .catch((e) => alert("Unable to share screen: " + e.message));
    } else {
        stopScreenShare();
    }
}

function stopScreenShare() {
    if (!screenshareEnabled) return;
    screenshareEnabled = false;

    if (myScreenTrack) {
        myScreenTrack.stop();
        myScreenTrack.onended = null;
        myScreenTrack = null;
    }

    ws.send(JSON.stringify({
        type: 'screen_share_stopped',
        sender_email: userEmail
    }));

    const cameraTrack = myCameraStream.getVideoTracks()[0];
    // replaceTrack + renegotiate để remote nhận lại camera stream
    Object.entries(peers).forEach(async ([peerEmail, pc]) => {
        const sender = pc.getSenders().find(s => s.track?.kind === "video");
        if (sender) {
            await sender.replaceTrack(cameraTrack);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({ type: 'offer', target: peerEmail, offer }));
                console.log(`[StopScreenShare] Renegotiated with ${peerEmail}`);
            } catch (e) {
                console.error(`[StopScreenShare] Renegotiate error:`, e);
            }
        }
    });

    mystream = new MediaStream([
        cameraTrack,
        ...mystream.getAudioTracks()
    ]);
    myvideo.srcObject = mystream;

    delete activeScreenShares[userEmail];
    if (viewingScreenShare === userEmail) {
        const remaining = Object.keys(activeScreenShares);
        if (remaining.length === 0) {
            viewingScreenShare = null;
            hideScreenShareMain();
        } else {
            viewingScreenShare = remaining[0];
            const nextBox = document.getElementById(`video-${remaining[0]}`);
            if (nextBox) {
                const stream = nextBox.querySelector('video').srcObject;
                showScreenShareMain(stream, activeScreenShares[remaining[0]].name);
            }
            updateScreenShareSelector();
        }
    }

    screenShareButt.innerHTML = '<i class="fas fa-desktop"></i><span class="tooltiptext">Share Screen</span>';
    screenShareButt.style.backgroundColor = '';
}

// =================== CHAT ===================

function displayMessage(data) {
    const isMe = data.sender_email === userEmail;
    const align = isMe ? 'right' : 'left';
    const bg = isMe ? '#d9dae9' : '#e8e8e8';
    const color = isMe ? '#666' : '#666';

    let senderDisplay;
    if (isMe) {
        senderDisplay = displayName;
    } else {
        const info = participantInfo[data.sender_email];
        if (info) {
            senderDisplay = info.displayName;
        } else if (data.sender_name && data.sender_name !== data.sender_email) {
            senderDisplay = `${data.sender_name} (${data.sender_email})`;
        } else {
            senderDisplay = data.sender_email;
        }
    }

    let contentHtml = '';
    if (data.msg_type === 'text') {
        contentHtml = data.content;
    } else if (data.msg_type === 'image') {
        contentHtml = `<img src="${data.file_url}" style="max-width:200px;border-radius:8px;">`;
    } else if (data.msg_type === 'video') {
        contentHtml = `<video src="${data.file_url}" controls style="max-width:200px;border-radius:8px;"></video>`;
    } else {
        contentHtml = `<a href="${data.file_url}" target="_blank">${data.file_name}</a>`;
    }

    const time = new Date(data.timestamp || Date.now())
        .toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    chatRoom.innerHTML += `
        <div style="
            display:flex;
            justify-content:${isMe ? 'flex-end' : 'flex-start'};
            margin:8px 0;
            width:100%;
        ">
            <div style="
                max-width:75%;
                display:flex;
                flex-direction:column;
                align-items:${isMe ? 'flex-end' : 'flex-start'};
            ">
                <div style="
                    font-size:12px;
                    color:#666;
                    margin-bottom:4px;
                    text-align:${align};
                ">
                    <b>${senderDisplay}</b> ${time}
                </div>

                <div style="
                    background:${bg};
                    padding:8px 12px;
                    border-radius:12px;
                    box-shadow:0 1px 2px rgba(0,0,0,0.1);
                    word-break:break-word;
                    color:${color};
                ">
                    ${contentHtml}
                </div>
            </div>
        </div>
    `;

    chatRoom.scrollTop = chatRoom.scrollHeight;
}

sendButton.addEventListener('click', sendMessage);
messageField.addEventListener("keyup", (event) => {
    if (event.keyCode === 13) sendMessage();
});

function sendMessage() {
    const msg = messageField.value.trim();
    if (!msg || !ws) return;

    ws.send(JSON.stringify({
        type: 'chat',
        content: msg,
        msg_type: 'text'
    }));

    displayMessage({
        sender_email: userEmail,
        sender_name: userFullName,
        msg_type: 'text',
        content: msg,
        timestamp: new Date().toISOString()
    });

    messageField.value = '';
}

const attachBtn = document.createElement('button');
attachBtn.innerHTML = '<i class="fas fa-paperclip"></i>';
attachBtn.title = 'Đính kèm file';
attachBtn.style.cssText = `
    background: none;
    border: 2px solid #aaa;
    border-radius: 8px;
    cursor: pointer;
    color: #555;
    height: 36px;
    width: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    transition: all 0.2s;
    flex-shrink: 0;
`;
attachBtn.onmouseover = () => { attachBtn.style.borderColor = '#323cae'; attachBtn.style.color = '#323cae'; };
attachBtn.onmouseout = () => { attachBtn.style.borderColor = '#aaa'; attachBtn.style.color = '#555'; };
attachBtn.onclick = () => fileInput.click();
// Thêm vào ci-send (bên cạnh nút Gửi), đặt trước nút Gửi
const ciSend = document.querySelector('.ci-send');
ciSend.insertBefore(attachBtn, ciSend.firstChild);

fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !ws) return;

    const originalBtn = attachBtn.innerHTML;
    attachBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_URL}/meetings/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        if (!response.ok) throw new Error('Upload failed');
        const data = await response.json();

        let msgType = 'file';
        if (file.type.startsWith('image/')) msgType = 'image';
        else if (file.type.startsWith('video/')) msgType = 'video';

        ws.send(JSON.stringify({
            type: 'chat',
            content: data.file_id,
            msg_type: msgType,
            file_name: file.name,
            file_size: file.size
        }));

        displayMessage({
            sender_email: userEmail,
            sender_name: userFullName,
            msg_type: msgType,
            content: file.name,
            file_url: data.url,
            file_name: file.name,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        alert('Lỗi upload file: ' + err.message);
    } finally {
        attachBtn.innerHTML = originalBtn;
        fileInput.value = '';
    }
});

// =================== WHITEBOARD ===================

whiteboardCont.style.visibility = 'hidden';

whiteboardButt.addEventListener('click', () => {
    boardVisisble = !boardVisisble;
    whiteboardCont.style.visibility = boardVisisble ? 'visible' : 'hidden';
});

function setColor(newcolor) {
    color = newcolor;
    drawsize = 3;
}

function setEraser() {
    color = "white";
    drawsize = 10;
}

function clearBoard() {
    if (window.confirm('Xóa bảng?')) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ws.send(JSON.stringify({ type: 'whiteboard_clear' }));
    }
}

canvas.addEventListener('mousedown', e => {
    x = e.offsetX;
    y = e.offsetY;
    isDrawing = 1;
});

canvas.addEventListener('mousemove', e => {
    if (!isDrawing || !ws) return;
    draw(e.offsetX, e.offsetY, x, y);
    ws.send(JSON.stringify({
        type: 'whiteboard_draw',
        data: { newX: e.offsetX, newY: e.offsetY, prevX: x, prevY: y, color, size: drawsize }
    }));
    x = e.offsetX;
    y = e.offsetY;
});

window.addEventListener('mouseup', () => isDrawing = 0);

function draw(newx, newy, oldx, oldy) {
    ctx.strokeStyle = color;
    ctx.lineWidth = drawsize;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(oldx, oldy);
    ctx.lineTo(newx, newy);
    ctx.stroke();
    ctx.closePath();
}

function drawRemote(data) {
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(data.prevX, data.prevY);
    ctx.lineTo(data.newX, data.newY);
    ctx.stroke();
    ctx.closePath();
}

setInterval(() => {
    if (boardVisisble && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'whiteboard_save', canvas: canvas.toDataURL() }));
    }
}, 5000);

// =================== END CALL ===================

// cutCall.addEventListener('click', () => {
//     if (isHost && confirm('Bạn có chắc muốn kết thúc cuộc họp cho tất cả? Mọi file sẽ bị xóa.')) {
//         ws.send(JSON.stringify({ type: 'end_room' }));
//     } else if (!isHost) {
//         ws.close();
//         location.href = '/';
//     }
// });

// window.addEventListener('beforeunload', () => {
//     if (ws && ws.readyState === WebSocket.OPEN) ws.close();
// });
cutCall.addEventListener('click', () => {
    if (isHost && confirm('Bạn có chắc muốn kết thúc cuộc họp cho tất cả? Mọi file sẽ bị xóa.')) {
        ws.send(JSON.stringify({ type: 'end_room' }));
    } else if (!isHost) {
        const savedChannel = sessionStorage.getItem('lastVoiceChannel');
        const savedChatroom = sessionStorage.getItem('lastVoiceRoom');
        if (savedChannel && savedChatroom) {
            location.href = `/channel.html?channel=${savedChannel}&chatroom=${savedChatroom}&return=1`;
        } else {
            location.href = '/';
        }
        ws.close();
    }
});