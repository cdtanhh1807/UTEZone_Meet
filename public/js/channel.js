const API_URL = 'http://localhost:8000';
const LOGIN_URL = 'http://localhost:5173/login';

function redirectToLogin() {
    var currentUrl = window.location.href;
    var loginUrl = LOGIN_URL + '?redirect=' + encodeURIComponent(currentUrl);
    window.location.href = loginUrl;
}
var unreadChannelCounts = {};
var fileUrlCache = {};

async function getFileUrl(fileId) {
    if (fileUrlCache[fileId]) return fileUrlCache[fileId];
    try {
        // Sửa endpoint: thêm prefix /channels
        const data = await apiCall(`/channels/files/${fileId}`);
        fileUrlCache[fileId] = data.url;
        return data.url;
    } catch (err) {
        console.error('Failed to get file URL:', err);
        return null;
    }
}

function getToken() {
    var token = localStorage.getItem('token');
    if (!token) {
        var urlParams = new URLSearchParams(window.location.search);
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

function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 10);
    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
}

async function apiCall(endpoint, method, body) {
    method = method || 'GET';
    var token = getToken();
    if (!token) return Promise.reject('No token');
    var options = {
        method: method,
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    try {
        const res = await fetch(API_URL + endpoint, options);
        if (res.status === 401) {
            localStorage.removeItem('token');
            redirectToLogin();
            throw new Error('Unauthorized');
        }
        if (!res.ok) {
            // Đọc chi tiết lỗi từ response
            const errorData = await res.json().catch(() => ({}));
            const errorMsg = errorData.detail || errorData.message || `HTTP ${res.status}`;
            throw new Error(errorMsg);
        }
        return await res.json();
    } catch (err) {
        console.error(`API Error ${endpoint}:`, err);
        throw err;
    }
}

// ====== State ======
var currentChannel = null;
var currentChatroom = null;
var channelList = [];
var chatroomList = [];
var memberList = [];
var messageList = [];
var messagePollingTimer = null;
var memberPollingTimer = null;   // <-- Thêm timer cập nhật members

let channelPollingTimer = null;
let chatroomPollingTimer = null;


var avatarCache = {};
async function getUserAvatar(email) {
    if (avatarCache[email]) return avatarCache[email];
    try {
        const data = await apiCall(`/account/account_info?email=${email}`);
        const avatar = data.avatar || null;
        avatarCache[email] = avatar;
        return avatar;
    } catch (err) {
        console.error(`Failed to get avatar for ${email}:`, err);
        return null;
    }
}


// Cập nhật avatar ở header channel detail
function updateChannelAvatarInUI() {
    const avatarContainer = document.getElementById('channel-avatar');
    if (avatarContainer) {
        if (currentChannel && currentChannel.avatar) {
            avatarContainer.innerHTML = `<img src="${currentChannel.avatar}" class="channel-avatar-img" style="width:40px;height:40px;">`;
        } else {
            avatarContainer.innerHTML = '<i class="fas fa-hashtag"></i>';
        }
    }
}

// Hiển thị preview trong modal settings
function loadChannelAvatarPreview() {
    const img = document.getElementById('channel-avatar-preview');
    const placeholder = document.getElementById('channel-avatar-placeholder');
    if (!currentChannel || !currentChannel.avatar) {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
    } else {
        img.src = currentChannel.avatar;
        img.style.display = 'block';
        placeholder.style.display = 'none';
    }
}
document.getElementById('btn-upload-avatar')?.addEventListener('click', () => {
    document.getElementById('avatar-file-input').click();
});
document.getElementById('avatar-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/channels/${currentChannel.channel_id}/avatar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        if (!response.ok) throw new Error('Upload failed');
        const data = await response.json();
        currentChannel.avatar = data.avatar_url;
        loadChannelAvatarPreview();
        updateChannelAvatarInUI();
        // Cập nhật avatar trong channel list (sidebar)
        renderChannelList();
        showToast('Cập nhật ảnh đại diện thành công', 'success');
    } catch (err) {
        showToast('Lỗi upload: ' + err.message, 'error');
    }
});

// Xóa avatar
document.getElementById('btn-remove-avatar')?.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc muốn xóa ảnh đại diện?')) return;
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/channels/${currentChannel.channel_id}/avatar`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Delete failed');
        currentChannel.avatar = null;
        loadChannelAvatarPreview();
        updateChannelAvatarInUI();
        renderChannelList();
        showToast('Đã xóa ảnh đại diện', 'success');
    } catch (err) {
        showToast('Lỗi xóa ảnh: ' + err.message, 'error');
    }
});

var unreadCounts = {}; // { room_id: count }

async function loadUnreadCounts(channelId) {
    try {
        const data = await apiCall(`/channels/${channelId}/unread-counts`);
        unreadCounts = data.unread_counts || {};
        renderChatroomList();
    } catch (err) {
        console.error('Failed to load unread counts:', err);
    }
}

function startChannelPolling() {
    if (channelPollingTimer) clearInterval(channelPollingTimer);
    channelPollingTimer = setInterval(() => {
        loadChannels();  // reload danh sách channel
    }, 2000);
}

function stopChannelPolling() {
    if (channelPollingTimer) {
        clearInterval(channelPollingTimer);
        channelPollingTimer = null;
    }
}

function startChatroomPolling() {
    if (chatroomPollingTimer) clearInterval(chatroomPollingTimer);
    chatroomPollingTimer = setInterval(() => {
        if (currentChannel) {
            loadChatrooms(currentChannel.channel_id);
        }
    }, 2000);
}

function stopChatroomPolling() {
    if (chatroomPollingTimer) {
        clearInterval(chatroomPollingTimer);
        chatroomPollingTimer = null;
    }
}

// ====== Auth and Init ======
var token = getToken();
if (!token) {
    throw new Error("Redirecting to login...");
}

// ================================================================ socket ===============================
let channelSocket = null;

function connectChannelWebsocket(channelId) {
    if (channelSocket) {
        channelSocket.close();
        channelSocket = null;
    }
    const token = getToken();
    if (!token) return;
    const wsUrl = `ws://localhost:8000/channels/ws/${channelId}?token=${token}`;
    channelSocket = new WebSocket(wsUrl);

    channelSocket.onopen = () => {
        console.log('Channel WebSocket connected');
        channelSocket.send(JSON.stringify({ type: 'ping' }));
    };

    channelSocket.onmessage = async function (event) {
        console.log('[WS] Received:', event.data);
        try {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'new_message':
                    if (data.message.sender_email !== getCurrentUserEmail()) {
                        const msgRoomId = data.message.room_id;
                        if (!currentChatroom || currentChatroom.room_id !== msgRoomId) {
                            unreadCounts[msgRoomId] = (unreadCounts[msgRoomId] || 0) + 1;
                            renderChatroomList();
                        }
                        if (currentChatroom && data.message.room_id === currentChatroom.room_id) {
                            if (!messageList.some(m => m.message_id === data.message.message_id)) {
                                messageList.push(data.message);
                                await appendNewMessages([data.message]);
                            }
                        }
                    }
                    break;
                case 'channel_deleted':
                    console.log('Channel deleted event received');
                    if (currentChannel && currentChannel.channel_id === data.channel_id) {
                        // showToast('Channel đã bị xóa bởi chủ kênh', 'warning');
                        currentChannel = null;
                        currentChatroom = null;
                        document.getElementById('channel-empty').style.display = 'flex';
                        document.getElementById('channel-detail').style.display = 'none';
                    }
                    loadChannels(); // reload danh sách
                    break;
                case 'chatroom_created':
                    console.log('Chatroom created:', data.chatroom);
                    if (currentChannel && currentChannel.channel_id === data.chatroom.channel_id) {
                        chatroomList.push(data.chatroom);
                        renderChatroomList();
                        showToast(`Phòng "${data.chatroom.name}" đã được tạo`, 'success');
                    }
                    break;
                case 'chatroom_deleted':
                    console.log('Chatroom deleted:', data.room_id);
                    if (currentChannel) {
                        const index = chatroomList.findIndex(r => r.room_id === data.room_id);
                        if (index !== -1) {
                            chatroomList.splice(index, 1);
                            renderChatroomList();
                            if (currentChatroom && currentChatroom.room_id === data.room_id) {
                                currentChatroom = null;
                                document.getElementById('chatroom-empty-inner').style.display = 'flex';
                                document.getElementById('chatroom-active').style.display = 'none';
                            }
                            showToast('Phòng chat đã bị xóa', 'warning');
                        }
                    }
                    break;
                case 'member_approved':
                    console.log('Member approved:', data.member);
                    const currentEmail = getCurrentUserEmail();
                    if (data.member.email === currentEmail) {
                        showToast('Bạn đã được chấp nhận tham gia kênh!', 'success');
                        loadChannels();
                    } else if (currentChannel && currentChannel.channel_id === data.member.channel_id) {
                        loadMembers(currentChannel.channel_id);
                    }
                    break;
                case 'channel_avatar_updated':
                    if (currentChannel && currentChannel.channel_id === data.channel_id) {
                        currentChannel.avatar = data.avatar_url;
                        updateChannelAvatarInUI();
                        loadChannelAvatarPreview(); // nếu modal đang mở
                        renderChannelList(); // cập nhật sidebar
                    }
                    break;
                default:
                    console.log('Unknown event type:', data.type);
            }
        } catch (err) {
            console.error('WebSocket message error:', err);
        }
    };


    channelSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    channelSocket.onclose = () => {
        console.log('❌ WebSocket closed:', event.code, event.reason);
        channelSocket = null;
    };
}
// ================================================================ socket ===============================

document.getElementById('channel-loading').style.display = 'none';
document.getElementById('channel-app').style.display = 'flex';

function loadChannels() {
    console.log('loadChannels called');
    apiCall('/channels/my-channels').then(function (data) {
        console.log('API response:', data);
        channelList = data.channels || data || [];
        console.log('channelList after assign:', channelList);
        renderChannelList();

        startChannelPolling();
    }).catch(function (err) {
        console.error('Load channels error:', err);
        showToast('Không thể tải danh sách kênh: ' + err.message, 'error');
    });
}

function renderChannelList() {
    var container = document.getElementById('channel-list');
    var searchTerm = document.getElementById('search-channel').value.toLowerCase();
    var filtered = channelList.filter(function (ch) {
        return ch.name.toLowerCase().indexOf(searchTerm) !== -1;
    });
    var html = '';
    filtered.forEach(function (ch) {
        var isActive = currentChannel && currentChannel.channel_id === ch.channel_id ? ' active' : '';
        var avatarHtml = ch.avatar
            ? `<img src="${ch.avatar}" class="channel-avatar-img" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`
            : '<i class="fas fa-hashtag"></i>';
        var unread = unreadChannelCounts[ch.channel_id] || 0;
        var unreadBadge = unread > 0 ? '<span class="unread-badge"></span>' : '';
        var channelNameClass = unread > 0 ? 'channel-item-name unread' : 'channel-item-name';
        html += '<div class="channel-item' + isActive + '" data-id="' + ch.channel_id + '" onclick="selectChannel(\'' + ch.channel_id + '\')">' +
            '<div class="channel-item-avatar">' + avatarHtml + '</div>' +
            '<div class="channel-item-info">' +
            '<div class="' + channelNameClass + '">' + escapeHtml(ch.name) + unreadBadge + '</div>' +
            '<div class="channel-item-desc">' + escapeHtml(ch.description || '') + '</div>' +
            '</div></div>';
    });
    container.innerHTML = html;
}

function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ====== Select Channel ======
function updateOwnerControls() {
    const isOwner = currentChannel && currentChannel.is_owner;
    const createChatroomBtn = document.getElementById('btn-create-chatroom');
    const channelSettingsBtn = document.getElementById('btn-channel-settings');
    const chatroomSettingsBtn = document.getElementById('btn-chatroom-settings');

    if (createChatroomBtn) {
        createChatroomBtn.style.display = isOwner ? 'inline-flex' : 'none';
    }
    if (channelSettingsBtn) {
        channelSettingsBtn.style.display = isOwner ? 'inline-flex' : 'none';
    }
    if (chatroomSettingsBtn) {
        // Chỉ hiển thị nút cài đặt phòng chat nếu là owner VÀ có phòng chat đang được chọn
        chatroomSettingsBtn.style.display = (isOwner && currentChatroom) ? 'inline-flex' : 'none';
    }
}

function selectChannel(channelId) {
    apiCall('/channels/' + channelId).then(async function (data) {
        currentChannel = data;
        currentChatroom = null;
        messageList = [];
        stopMessagePolling();
        stopMemberPolling();
        updateOwnerControls();

        // Reset giao diện chat về trạng thái chưa chọn room
        const emptyInner = document.getElementById('chatroom-empty-inner');
        const activeDiv = document.getElementById('chatroom-active');
        if (emptyInner) emptyInner.style.display = 'flex';
        if (activeDiv) activeDiv.style.display = 'none';
        const messagesContainer = document.getElementById('chatroom-messages');
        if (messagesContainer) messagesContainer.innerHTML = '';

        await setUserSession(channelId, null);

        connectChannelWebsocket(channelId);

        renderChannelDetail();
        renderChannelList();
        await loadChatrooms(channelId);
        await loadUnreadCounts(channelId);
        startChatroomPolling();

        handleReturnFromMeeting();

        loadMembers(channelId);
        startMemberPolling(channelId);
    }).catch(function (err) {
        console.error('Select channel error:', err);
        showToast('Không thể tải thông tin kênh: ' + err.message, 'error');
        if (err.message.includes('404') || err.message.includes('không tồn tại')) {
            const url = new URL(window.location);
            url.searchParams.delete('channel');
            url.searchParams.delete('chatroom');
            url.searchParams.delete('return');
            window.history.replaceState({}, '', url);
        }
        throw err;
    });
}

function renderChannelDetail() {
    document.getElementById('channel-empty').style.display = 'none';
    document.getElementById('channel-detail').style.display = 'flex';
    // Cập nhật avatar ở header
    const avatarContainer = document.getElementById('channel-avatar');
    if (avatarContainer) {
        if (currentChannel.avatar) {
            avatarContainer.innerHTML = `<img src="${currentChannel.avatar}" class="channel-avatar-img" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`;
        } else {
            avatarContainer.innerHTML = '<i class="fas fa-hashtag"></i>';
        }
    }
    document.getElementById('channel-name').textContent = currentChannel.name;
    document.getElementById('channel-description').textContent = currentChannel.description || 'Không có mô tả';
    var memberCount = currentChannel.member_count || (memberList ? memberList.length : 0);
    document.getElementById('member-count').innerHTML = '<i class="fas fa-users"></i> <span>' + memberCount + '</span>';

    var leaveBtn = document.getElementById('btn-leave-channel');
    if (currentChannel.is_owner) {
        leaveBtn.title = 'Xóa kênh';
        leaveBtn.innerHTML = '<i class="fas fa-trash"></i>';
    } else {
        leaveBtn.title = 'Rời kênh';
        leaveBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
    }
}

// ====== Chatrooms ======
function loadChatrooms(channelId) {
    return apiCall('/channels/' + channelId + '/chatrooms').then(function (data) {
        chatroomList = data.chatrooms || data || [];
        renderChatroomList();
    }).catch(function (err) {
        console.error('Load chatrooms error:', err);
        chatroomList = [];
        renderChatroomList();
    });
}

function renderChatroomList() {
    var container = document.getElementById('chatroom-list');
    if (!chatroomList.length) {
        container.innerHTML = '<div class="empty-chatrooms">Chưa có phòng chat nào</div>';
        return;
    }
    var textRooms = chatroomList.filter(function (r) { return r.room_type === 'text' || !r.room_type; });
    var voiceRooms = chatroomList.filter(function (r) { return r.room_type === 'voice'; });
    var html = '';
    if (textRooms.length) {
        html += '<div class="chatroom-group"><div class="chatroom-group-title"><i class="fas fa-hashtag"></i> Trò chuyện</div>';
        textRooms.forEach(function (r) {
            var isActive = currentChatroom && currentChatroom.room_id === r.room_id ? ' active' : '';
            var unread = unreadCounts[r.room_id] || 0;
            var unreadBadge = unread > 0 ? '<span class="unread-badge"></span>' : '';
            var roomNameClass = unread > 0 ? 'chatroom-item-name unread' : 'chatroom-item-name';
            html += '<div class="chatroom-item' + isActive + '" onclick="selectChatroom(\'' + r.room_id + '\')">' +
                '<span class="chatroom-item-icon"><i class="fas fa-hashtag"></i></span>' +
                '<span class="chatroom-item-name">' + escapeHtml(r.name) + '</span>' +
                unreadBadge +
                '</div>';
        });
        html += '</div>';
    }
    if (voiceRooms.length) {
        html += '<div class="chatroom-group"><div class="chatroom-group-title"><i class="fas fa-volume-up"></i> Họp</div>';
        voiceRooms.forEach(function (r) {
            var isActive = currentChatroom && currentChatroom.room_id === r.room_id ? ' active' : '';
            var unread = unreadCounts[r.room_id] || 0;
            var unreadBadge = unread > 0 ? '<span class="unread-badge">*</span>' : '';
            var roomNameClass = unread > 0 ? 'chatroom-item-name unread' : 'chatroom-item-name';
            html += '<div class="chatroom-item' + isActive + '" onclick="selectChatroom(\'' + r.room_id + '\')">' +
                '<span class="chatroom-item-icon"><i class="fas fa-volume-up"></i></span>' +
                '<span class="' + roomNameClass + '">' + escapeHtml(r.name) + unreadBadge + '</span>' +
                '</div>';
        });
        html += '</div>';
    }
    container.innerHTML = html;
}

// ====== Select Chatroom ======
function selectChatroom(roomId) {
    console.log('[selectChatroom] roomId:', roomId);

    // Hàm xử lý sau khi có currentChatroom
    function applyRoom(room) {
        console.log('[applyRoom]', room);
        currentChatroom = room;
        updateOwnerControls();
        messageList = [];
        renderChatroomActive();
        renderChatroomList();  // cập nhật highlight

        if (currentChatroom.room_type === 'voice') {
            stopMessagePolling();
            renderVoiceRoom();
        } else {
            refreshMessages();
        }
    }

    apiCall(`/channels/chatrooms/${roomId}/mark-read`, 'POST').catch(console.error);
    // Xóa unread badge local
    if (unreadCounts[roomId]) {
        delete unreadCounts[roomId];
        renderChatroomList();
    }

    // Nếu chatroomList đã có dữ liệu
    if (chatroomList.length > 0) {
        let found = chatroomList.find(r => String(r.room_id) === String(roomId));
        if (found) {
            applyRoom(found);
            return;
        }
        // Không tìm thấy trong list → gọi API lấy riêng
        console.warn('Room not in list, fetching from API');
        apiCall('/channels/chatrooms/' + roomId)
            .then(room => applyRoom(room))
            .catch(err => {
                console.error('Failed to fetch room:', err);
                // fallback
                applyRoom({ room_id: roomId, name: 'Phòng chat', room_type: 'text' });
            });
    } else {
        // chatroomList đang rỗng → gọi API trực tiếp
        console.log('chatroomList empty, fetching from API');
        apiCall('/channels/chatrooms/' + roomId)
            .then(room => applyRoom(room))
            .catch(err => {
                console.error('Failed to fetch room:', err);
                applyRoom({ room_id: roomId, name: 'Phòng chat', room_type: 'text' });
            });
    }
}


function renderChatroomActive() {
    if (!currentChatroom) return;

    const emptyInner = document.getElementById('chatroom-empty-inner');
    if (emptyInner) emptyInner.style.display = 'none';

    const activeDiv = document.getElementById('chatroom-active');
    if (activeDiv) activeDiv.style.display = 'flex';

    const nameEl = document.getElementById('chatroom-name');
    if (nameEl) nameEl.textContent = currentChatroom.name;

    const descEl = document.getElementById('chatroom-desc');
    if (descEl) descEl.textContent = currentChatroom.description || '';

    const welcomeEl = document.getElementById('welcome-room-name');
    if (welcomeEl) welcomeEl.textContent = currentChatroom.name;

    const typeIconEl = document.getElementById('chatroom-type-icon');
    if (typeIconEl) {
        typeIconEl.innerHTML = currentChatroom.room_type === 'voice' ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-hashtag"></i>';
    }

    const startBtn = document.getElementById('btn-start-meeting');
    if (startBtn) {
        // startBtn.style.display = currentChatroom.room_type === 'voice' ? 'inline-flex' : 'none';
        startBtn.style.display = 'none';
    }
    updateMediaButtonsVisibility();
}

function renderVoiceRoom() {
    var messagesContainer = document.getElementById('chatroom-messages');
    if (!messagesContainer) return;
    var inputArea = document.querySelector('.chatroom-input-area');
    if (inputArea) inputArea.style.display = 'none';

    messagesContainer.innerHTML = '';

    var html = '<div class="voice-room">' +
        '<div class="voice-room-header">' +
        '<i class="fas fa-volume-up" style="font-size:48px;color:#323cae;"></i>' +
        '<h3>' + escapeHtml(currentChatroom.name) + '</h3>' +
        '<p>' + escapeHtml(currentChatroom.description || 'Phòng họp') + '</p>' +
        '</div>' +
        '<div class="voice-room-actions">' +
        '<button class="btn-join-voice" id="btn-join-voice" onclick="joinVoiceRoom()">' +
        '<i class="fas fa-headphones"></i> Tham gia họp</button>' +
        '</div>' +
        '</div>';

    messagesContainer.innerHTML = html;
}

var isInVoiceRoom = false;

function joinVoiceRoom() {
    if (!currentChatroom) return;
    sessionStorage.setItem('lastVoiceChannel', currentChannel.channel_id);
    sessionStorage.setItem('lastVoiceRoom', currentChatroom.room_id);
    apiCall('/channels/chatrooms/' + currentChatroom.room_id + '/start-meeting', 'POST').then(function (data) {
        location.href = `/room.html?room=${data.room_id}&channel=${currentChannel.channel_id}&chatroom=${currentChatroom.room_id}`;
    }).catch(function (err) {
        showToast('Lỗi tham gia phòng họp: ' + err.message, 'error');
    });
}


async function appendNewMessages(newMessages) {
    var container = document.getElementById('chatroom-messages');
    if (!container) return;

    // Preload avatar cho tất cả người gửi
    for (let msg of newMessages) {
        if (msg.sender_email && !avatarCache[msg.sender_email]) {
            await getUserAvatar(msg.sender_email);
        }
    }

    const fileMessages = newMessages.filter(m => m.msg_type !== 'text' && m.content && !fileUrlCache[m.content]);
    for (let msg of fileMessages) {
        try {
            const urlData = await apiCall(`/channels/files/${msg.content}`);
            fileUrlCache[msg.content] = urlData.url;
        } catch (err) {
            console.error(`Lỗi lấy URL cho ${msg.content}:`, err);
            fileUrlCache[msg.content] = null;
        }
    }

    var wasAtBottom = (container.scrollHeight - container.scrollTop) <= (container.clientHeight + 50);
    var html = '';
    var currentDate = '';
    if (messageList.length > 0) {
        var lastMsgDate = formatDate(messageList[messageList.length - 1].created_at);
        currentDate = lastMsgDate;
    }

    newMessages.forEach(function (msg) {
        var msgDate = formatDate(msg.created_at);
        if (msgDate !== currentDate) {
            html += '<div class="message-date-separator"><span>' + msgDate + '</span></div>';
            currentDate = msgDate;
        }

        var isOwn = msg.sender_email === getCurrentUserEmail();
        var contentHtml = '';
        var msgType = msg.msg_type || 'text';
        var fileUrl = (msgType !== 'text' && msg.content && fileUrlCache[msg.content]) ? fileUrlCache[msg.content] : null;

        // Xử lý nội dung tin nhắn (giữ nguyên code cũ)
        if (msgType === 'image') {
            contentHtml = fileUrl ? `<img src="${fileUrl}" style="max-width:250px; max-height:250px; border-radius:8px; cursor:pointer;" onclick="window.open('${fileUrl}')" />` : '<span class="file-placeholder">Đang tải ảnh...</span>';
        } else if (msgType === 'video') {
            contentHtml = fileUrl ? `<video src="${fileUrl}" controls style="max-width:250px; border-radius:8px;"></video>` : '<span class="file-placeholder">Đang tải video...</span>';
        } else if (msgType === 'file') {
            if (fileUrl) {
                var fileName = msg.file_name || 'Tải file';
                var icon = '<i class="fas fa-paperclip"></i>';
                var ext = (fileName.split('.').pop() || '').toLowerCase();
                if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) icon = '<i class="fas fa-file-image"></i>';
                else if (['mp4', 'webm', 'mov'].includes(ext)) icon = '<i class="fas fa-file-video"></i>';
                else if (['pdf'].includes(ext)) icon = '<i class="fas fa-file-pdf"></i>';
                else if (['doc', 'docx'].includes(ext)) icon = '<i class="fas fa-file-word"></i>';
                else if (['xls', 'xlsx'].includes(ext)) icon = '<i class="fas fa-file-excel"></i>';
                else if (['zip', 'rar', '7z'].includes(ext)) icon = '<i class="fas fa-file-archive"></i>';
                contentHtml = `<a href="${fileUrl}" target="_blank" style="color:#323cae; text-decoration:none;">${icon} ${escapeHtml(fileName)}</a>`;
            } else {
                contentHtml = '<span class="file-placeholder">Đang tải...</span>';
            }
        } else {
            contentHtml = escapeHtml(msg.content || '');
        }

        // Tạo avatar HTML
        const avatarUrl = avatarCache[msg.sender_email];
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" class="message-avatar-img" onerror="this.onerror=null;this.style.display='none';this.nextSibling.style.display='flex'">`
            : '';
        const letterHtml = `<div class="message-avatar-letter" style="${avatarUrl ? 'display:none' : 'display:flex'}">${getAvatarLetter(msg.sender_name || msg.sender_email)}</div>`;

        html += '<div class="message-item' + (isOwn ? ' own' : '') + '"' +
            (msg.message_id && msg.message_id.startsWith('temp_') ? ` data-temp-id="${msg.message_id}"` : '') + '>' +
            '<div class="message-avatar">' +
            avatarHtml +
            letterHtml +
            '</div>' +
            '<div class="message-content">' +
            '<div class="message-header">' +
            '<span class="message-sender">' + escapeHtml(msg.sender_name || msg.sender_email) + '</span>' +
            '<span class="message-time">' + formatTime(msg.created_at) + '</span>' +
            '</div>' +
            '<div class="message-text">' + contentHtml + '</div>' +
            '</div>' +
            '</div>';
    });

    container.insertAdjacentHTML('beforeend', html);
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

let lastLoadedMessageId = null;
async function loadMessages() {
    if (!currentChatroom) return;
    try {
        const data = await apiCall('/channels/chatrooms/' + currentChatroom.room_id + '/messages?limit=50');
        const newMessages = data.messages || [];
        if (newMessages.length === 0) return;

        // Preload URLs cho tất cả tin nhắn có file (ảnh, video, file)
        const fileMessages = newMessages.filter(m => m.msg_type !== 'text');
        for (let msg of fileMessages) {
            if (msg.content && !fileUrlCache[msg.content]) {
                try {
                    const urlData = await apiCall(`/channels/files/${msg.content}`);
                    fileUrlCache[msg.content] = urlData.url;
                } catch (err) {
                    console.error(`Lỗi lấy URL cho ${msg.content}:`, err);
                    fileUrlCache[msg.content] = null;
                }
            }
        }

        // Nếu chưa có tin nhắn nào, gán toàn bộ và render
        if (messageList.length === 0) {
            messageList = newMessages;
            renderMessages();
            return;
        }

        // Tìm những tin nhắn mới (chưa có trong messageList)
        const existingIds = new Set(messageList.map(m => m.message_id));
        const addedMessages = newMessages.filter(m => !existingIds.has(m.message_id));

        if (addedMessages.length > 0) {
            messageList.push(...addedMessages);
            appendNewMessages(addedMessages);
        }
    } catch (err) {
        console.error('Load messages error:', err);
    }
}

async function renderMessages() {
    // Preload avatar cho tất cả người gửi
    for (let msg of messageList) {
        if (msg.sender_email && !avatarCache[msg.sender_email]) {
            await getUserAvatar(msg.sender_email);
        }
    }

    const fileMessages = messageList.filter(m => m.msg_type !== 'text' && m.content && !fileUrlCache[m.content]);
    for (let msg of fileMessages) {
        try {
            const urlData = await apiCall(`/channels/files/${msg.content}`);
            fileUrlCache[msg.content] = urlData.url;
        } catch (err) {
            console.error(`Lỗi lấy URL cho ${msg.content}:`, err);
            fileUrlCache[msg.content] = null;
        }
    }
    var container = document.getElementById('chatroom-messages');
    var inputArea = document.querySelector('.chatroom-input-area');

    if (inputArea && currentChatroom && currentChatroom.room_type !== 'voice') {
        inputArea.style.display = 'flex';
    }

    var savedScrollTop = container.scrollTop;
    var wasAtBottom = (container.scrollHeight - savedScrollTop) <= (container.clientHeight + 50);

    var html = '<div class="chat-welcome">' +
        '<i class="fas fa-hashtag" style="font-size:40px;color:#323cae;"></i>' +
        '<h3>Chào mừng đến <span id="welcome-room-name">' + escapeHtml(currentChatroom.name) + '</span></h3>' +
        '</div>';

    if (!messageList || messageList.length === 0) {
        html += '<div class="no-messages">Chưa có tin nhắn nào. Hãy gửi tin nhắn đầu tiên!</div>';
    } else {
        var currentDate = '';
        messageList.forEach(function (msg) {
            var msgDate = formatDate(msg.created_at);
            if (msgDate !== currentDate) {
                currentDate = msgDate;
                html += '<div class="message-date-separator"><span>' + msgDate + '</span></div>';
            }

            var isOwn = msg.sender_email === getCurrentUserEmail();
            var contentHtml = '';
            var msgType = msg.msg_type || 'text';
            var fileUrl = (msgType !== 'text' && msg.content && fileUrlCache[msg.content]) ? fileUrlCache[msg.content] : null;

            if (msgType === 'image') {
                contentHtml = fileUrl ? `<img src="${fileUrl}" style="max-width:250px; max-height:250px; border-radius:8px; cursor:pointer;" onclick="window.open('${fileUrl}')" />` : '<span class="file-placeholder">Đang tải ảnh...</span>';
            } else if (msgType === 'video') {
                contentHtml = fileUrl ? `<video src="${fileUrl}" controls style="max-width:250px; border-radius:8px;"></video>` : '<span class="file-placeholder">Đang tải video...</span>';
            } else if (msgType === 'file') {
                if (fileUrl) {
                    var fileName = msg.file_name || 'Tải file';
                    var icon = '<i class="fas fa-paperclip"></i>';
                    var ext = (fileName.split('.').pop() || '').toLowerCase();
                    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) icon = '<i class="fas fa-file-image"></i>';
                    else if (['mp4', 'webm', 'mov'].includes(ext)) icon = '<i class="fas fa-file-video"></i>';
                    else if (['pdf'].includes(ext)) icon = '<i class="fas fa-file-pdf"></i>';
                    else if (['doc', 'docx'].includes(ext)) icon = '<i class="fas fa-file-word"></i>';
                    else if (['xls', 'xlsx'].includes(ext)) icon = '<i class="fas fa-file-excel"></i>';
                    else if (['zip', 'rar', '7z'].includes(ext)) icon = '<i class="fas fa-file-archive"></i>';
                    contentHtml = `<a href="${fileUrl}" target="_blank" style="color:#323cae; text-decoration:none;">${icon} ${escapeHtml(fileName)}</a>`;
                } else {
                    contentHtml = '<span class="file-placeholder">Đang tải...</span>';
                }
            } else {
                contentHtml = escapeHtml(msg.content || '');
            }

            // Lấy avatar URL từ cache
            const avatarUrl = avatarCache[msg.sender_email];
            const avatarHtml = avatarUrl
                ? `<img src="${avatarUrl}" class="message-avatar-img" onerror="this.onerror=null;this.style.display='none';this.nextSibling.style.display='flex'">`
                : '';
            const letterHtml = `<div class="message-avatar-letter" style="${avatarUrl ? 'display:none' : 'display:flex'}">${getAvatarLetter(msg.sender_name || msg.sender_email)}</div>`;

            html += '<div class="message-item' + (isOwn ? ' own' : '') + '">' +
                '<div class="message-avatar">' +
                avatarHtml +
                letterHtml +
                '</div>' +
                '<div class="message-content">' +
                '<div class="message-header">' +
                '<span class="message-sender">' + escapeHtml(msg.sender_name || msg.sender_email) + '</span>' +
                '<span class="message-time">' + formatTime(msg.created_at) + '</span>' +
                '</div>' +
                '<div class="message-text">' + contentHtml + '</div>' +
                '</div>' +
                '</div>';
        });
    }

    container.innerHTML = html;

    setTimeout(function () {
        if (wasAtBottom) {
            container.scrollTop = container.scrollHeight;
        } else {
            if (savedScrollTop <= container.scrollHeight) {
                container.scrollTop = savedScrollTop;
            } else {
                container.scrollTop = container.scrollHeight;
            }
        }
    }, 0);
}

async function refreshMessages() {
    if (!currentChatroom) return;
    try {
        const data = await apiCall('/channels/chatrooms/' + currentChatroom.room_id + '/messages?limit=50');
        const newMessages = data.messages || [];

        // Preload URLs cho file messages
        for (let msg of newMessages) {
            if (msg.msg_type !== 'text' && msg.content && !fileUrlCache[msg.content]) {
                try {
                    const urlData = await apiCall(`/channels/files/${msg.content}`);
                    fileUrlCache[msg.content] = urlData.url;
                } catch (err) {
                    console.error(`Lỗi lấy URL cho ${msg.content}:`, err);
                    fileUrlCache[msg.content] = null;
                }
            }
        }

        messageList = newMessages;
        await renderMessages();
    } catch (err) {
        console.error('Refresh messages error:', err);
        showToast('Không thể tải tin nhắn', 'error');
    }
}

function getCurrentUserEmail() {
    try {
        var token = getToken();
        if (!token) return '';
        var payload = JSON.parse(atob(token.split('.')[1]));
        return payload.sub || '';
    } catch (e) {
        return '';
    }
}

function getAvatarLetter(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var hours = d.getHours().toString().padStart(2, '0');
    var mins = d.getMinutes().toString().padStart(2, '0');
    return hours + ':' + mins;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var today = new Date();
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Hôm nay';
    if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua';

    var day = d.getDate().toString().padStart(2, '0');
    var month = (d.getMonth() + 1).toString().padStart(2, '0');
    var year = d.getFullYear();
    return day + '/' + month + '/' + year;
}

// ====== Message Polling ======
function startMessagePolling() {
    stopMessagePolling();
    // messagePollingTimer = setInterval(function () {
    //     if (currentChatroom && currentChatroom.room_type !== 'voice') {
    //         loadMessages();
    //     }
    // }, 5000);
}

function stopMessagePolling() {
    if (messagePollingTimer) {
        clearInterval(messagePollingTimer);
        messagePollingTimer = null;
    }
}

// ====== Get user online ======
async function setUserSession(channelId, chatRoomId) {
    try {
        // Tạo query string từ params
        let url = `/channels/session/set?channel_id=${encodeURIComponent(channelId || '')}`;
        if (chatRoomId) {
            url += `&chat_room_id=${encodeURIComponent(chatRoomId)}`;
        }
        // Gọi POST không có body
        await apiCall(url, 'POST');
        console.log('Session set successfully', { channelId, chatRoomId });
    } catch (err) {
        console.error('Set session error:', err);
    }
}

async function clearUserSession() {
    try {
        await apiCall('/channels/session/clear', 'POST');
        stopChatroomPolling();
        if (channelSocket) {
            channelSocket.close();
            channelSocket = null;
        }
    } catch (err) {
        console.error('Clear session error:', err);
    }
}

window.addEventListener('beforeunload', () => {
    if (currentChannel) {
        clearUserSession();
    }
});

// ====== Members with polling ======
async function loadMembers(channelId) {
    if (!channelId) return;
    try {
        // Lấy danh sách thành viên (có status, role)
        const membersData = await apiCall('/channels/' + channelId + '/members');
        const allMembers = membersData.members || membersData || [];

        // Lấy danh sách online users
        const onlineData = await apiCall('/channels/' + channelId + '/online-users');
        const onlineEmails = (onlineData.online_users || []).map(u => u.email);

        // Gán is_online cho từng member
        memberList = allMembers.map(m => ({
            ...m,
            is_online: onlineEmails.includes(m.email),
            // Thêm avatar
            avatar: m.avatar || null
        }));

        renderMembers();
        if (currentChannel && currentChannel.channel_id === channelId) {
            document.getElementById('member-count').innerHTML = '<i class="fas fa-users"></i> <span>' + memberList.length + '</span>';
        }
    } catch (err) {
        console.error('Load members error:', err);
        memberList = [];
        renderMembers();
    }
}

function startMemberPolling(channelId) {
    stopMemberPolling();
    if (!channelId) return;
    memberPollingTimer = setInterval(function () {
        if (currentChannel && currentChannel.channel_id === channelId) {
            loadMembers(channelId);
        }
    }, 5000); // cập nhật mỗi 5 giây
}

function stopMemberPolling() {
    if (memberPollingTimer) {
        clearInterval(memberPollingTimer);
        memberPollingTimer = null;
    }
}

function renderMembers() {
    var onlineList = document.getElementById('online-members-list');
    var offlineList = document.getElementById('offline-members-list');
    var pendingSection = document.getElementById('members-pending');
    var pendingList = document.getElementById('pending-members-list');

    var onlineMembers = memberList.filter(function (m) { return m.is_online; });
    var offlineMembers = memberList.filter(function (m) { return !m.is_online && m.status !== 'pending'; });
    var pendingMembers = memberList.filter(function (m) { return m.status === 'pending'; });

    var onlineHtml = '';
    onlineMembers.forEach(function (m) { onlineHtml += renderMemberItem(m); });
    onlineList.innerHTML = onlineHtml || '<div class="no-members">Không có</div>';

    var offlineHtml = '';
    offlineMembers.forEach(function (m) { offlineHtml += renderMemberItem(m); });
    offlineList.innerHTML = offlineHtml || '<div class="no-members">Không có</div>';

    if (pendingMembers.length > 0 && currentChannel && currentChannel.is_owner) {
        pendingSection.style.display = 'block';
        var pendingHtml = '';
        pendingMembers.forEach(function (m) {
            pendingHtml += '<div class="member-item pending"><div class="member-avatar"><i class="fas fa-user-clock"></i></div>' +
                '<div class="member-info"><span class="member-name">' + escapeHtml(m.username || m.email || 'User') + '</span>' +
                '<span class="member-role">Chờ duyệt</span></div>' +
                '<button class="btn-approve" onclick="approveMember(\'' + m.email + '\')"><i class="fas fa-check"></i></button></div>';
        });
        pendingList.innerHTML = pendingHtml;
    } else {
        pendingSection.style.display = 'none';
    }
}

function renderMemberItem(m) {
    var role = m.role === 'owner' ? 'Chủ kênh' : m.role === 'admin' ? 'Quản trị' : 'Thành viên';
    var online = m.is_online ? ' online' : '';
    var avatarHtml = '';
    if (m.avatar) {
        avatarHtml = `<img src="${m.avatar}" class="member-avatar-img" onerror="this.onerror=null;this.src='';this.nextSibling.style.display='flex';this.style.display='none'" />`;
        avatarHtml += `<div class="member-avatar" style="display:none;"><i class="fas fa-user-circle"></i></div>`;
    } else {
        avatarHtml = `<div class="member-avatar"><i class="fas fa-user-circle"></i></div>`;
    }

    var displayName = m.username || m.email || 'User';
    var currentUserEmail = getCurrentUserEmail();
    if (m.email === currentUserEmail) {
        displayName += ' (Bạn)';
    }

    return `<div class="member-item${online}" data-email="${m.email}" onclick="viewProfile('${m.email}')">
                ${avatarHtml}
                <div class="member-info">
                    <span class="member-name">${escapeHtml(displayName)}</span>
                    <span class="member-role">${role}</span>
                </div>
            </div>`;
}

function viewProfile(email) {
    // Chuyển hướng đến trang profile của user
    window.open(`http://localhost:5173/profile/${encodeURIComponent(email)}`, '_blank');
}

function approveMember(memberEmail) {
    apiCall('/channels/' + currentChannel.channel_id + '/approve', 'POST', { email: memberEmail, approve: true }).then(function () {
        showToast('Đã phê duyệt thành viên', 'success');
        loadMembers(currentChannel.channel_id);
    }).catch(function (err) {
        showToast('Lỗi phê duyệt thành viên: ' + err.message, 'error');
    });
}


// ====== File Upload ======
const attachBtn = document.getElementById('btn-attach-file');
const fileInputChannel = document.getElementById('file-input');

if (attachBtn && fileInputChannel) {
    attachBtn.addEventListener('click', () => fileInputChannel.click());
    fileInputChannel.addEventListener('change', async () => {
        const file = fileInputChannel.files[0];
        if (!file || !currentChatroom || currentChatroom.room_type === 'voice') {
            if (currentChatroom?.room_type === 'voice') showToast('Không thể gửi file trong phòng voice', 'error');
            return;
        }

        const originalHtml = attachBtn.innerHTML;
        attachBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        attachBtn.disabled = true;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const token = getToken();
            const response = await fetch(`${API_URL}/channels/chatrooms/${currentChatroom.room_id}/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || 'Upload failed');
            }
            const data = await response.json();

            let msgType = 'file';
            if (file.type.startsWith('image/')) msgType = 'image';
            else if (file.type.startsWith('video/')) msgType = 'video';

            await apiCall(`/channels/chatrooms/${currentChatroom.room_id}/messages`, 'POST', {
                content: data.file_id,
                msg_type: msgType,
                file_id: data.file_id,
                file_name: file.name
            });
            loadMessages(); // reload để hiển thị file mới
            showToast('Đã gửi file', 'success');
        } catch (err) {
            console.error('Upload error:', err);
            showToast('Lỗi upload: ' + err.message, 'error');
        } finally {
            attachBtn.innerHTML = originalHtml;
            attachBtn.disabled = false;
            fileInputChannel.value = '';
        }
    });
}

//=========================================xử lý khi quay về từ meeting
function handleReturnFromMeeting() {
    const urlParams = new URLSearchParams(window.location.search);
    const channelId = urlParams.get('channel');
    const chatroomId = urlParams.get('chatroom');
    const isReturn = urlParams.has('return');
    if (isReturn && channelId && chatroomId) {
        // Xóa param return để không bị lặp
        const url = new URL(window.location);
        url.searchParams.delete('return');
        window.history.replaceState({}, '', url);

        if (currentChannel && currentChannel.channel_id === channelId) {
            // Đã ở đúng channel
            if (chatroomList.length > 0) {
                selectChatroom(chatroomId);
            } else {
                loadChatrooms(channelId).then(() => selectChatroom(chatroomId));
            }
        } else {
            // Cần chọn channel trước
            selectChannel(channelId).then(() => {
                const interval = setInterval(() => {
                    if (chatroomList.length > 0) {
                        clearInterval(interval);
                        selectChatroom(chatroomId);
                    }
                }, 100);
            });
        }
    }
}

// ====== Create Channel (FIXED with better error handling) ======
document.getElementById('btn-create-channel').addEventListener('click', function () {
    document.getElementById('modal-create-channel').style.display = 'flex';
});

document.getElementById('btn-submit-create-channel').addEventListener('click', async function () {
    var name = document.getElementById('input-channel-name').value.trim();
    var description = document.getElementById('input-channel-desc').value.trim();
    var requireApproval = document.getElementById('input-require-approval').checked;
    if (!name) { showToast('Vui lòng nhập tên kênh', 'error'); return; }

    const submitBtn = document.getElementById('btn-submit-create-channel');
    const originalText = submitBtn.innerText;
    submitBtn.disabled = true;
    submitBtn.innerText = 'Đang tạo...';

    try {
        await apiCall('/channels/create', 'POST', { name: name, description: description, require_approval: requireApproval });
        showToast('Tạo kênh thành công!', 'success');
        document.getElementById('modal-create-channel').style.display = 'none';
        document.getElementById('input-channel-name').value = '';
        document.getElementById('input-channel-desc').value = '';
        document.getElementById('input-require-approval').checked = false;
        await loadChannels();
    } catch (err) {
        console.error('Create channel error:', err);
        showToast('Lỗi tạo kênh: ' + err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
    }
});

// ====== Join Channel ======
document.getElementById('btn-join-channel').addEventListener('click', function () {
    document.getElementById('modal-join-channel').style.display = 'flex';
});

document.getElementById('btn-submit-join-channel').addEventListener('click', function () {
    var inviteCode = document.getElementById('input-invite-code').value.trim();
    if (!inviteCode) { showToast('Vui lòng nhập mã mời', 'error'); return; }
    apiCall('/channels/join', 'POST', { invite_code: inviteCode }).then(function (data) {
        if (data.status === 'pending') {
            showToast('Đã gửi yêu cầu tham gia, chờ phê duyệt', 'success');
        } else {
            showToast('Tham gia kênh thành công!', 'success');
        }
        document.getElementById('modal-join-channel').style.display = 'none';
        document.getElementById('input-invite-code').value = '';
        loadChannels();
    }).catch(function (err) {
        showToast('Lỗi tham gia kênh: ' + err.message, 'error');
    });
});

// ====== Create Chatroom ======
document.getElementById('btn-create-chatroom').addEventListener('click', function () {
    document.getElementById('modal-create-chatroom').style.display = 'flex';
});

document.getElementById('btn-submit-create-chatroom').addEventListener('click', function () {
    var name = document.getElementById('input-chatroom-name').value.trim();
    var description = document.getElementById('input-chatroom-desc').value.trim();
    var type = document.querySelector('input[name="chatroom-type"]:checked').value;
    if (!name) { showToast('Vui lòng nhập tên phòng', 'error'); return; }
    apiCall('/channels/' + currentChannel.channel_id + '/chatrooms', 'POST', { name: name, description: description, room_type: type }).then(function () {
        showToast('Tạo phòng chat thành công!', 'success');
        document.getElementById('modal-create-chatroom').style.display = 'none';
        document.getElementById('input-chatroom-name').value = '';
        document.getElementById('input-chatroom-desc').value = '';
        loadChatrooms(currentChannel.channel_id);
    }).catch(function (err) {
        showToast('Lỗi tạo phòng chat: ' + err.message, 'error');
    });
});

// ====== Channel Settings ======
document.getElementById('btn-channel-settings').addEventListener('click', function () {
    if (!currentChannel) return;
    document.getElementById('input-edit-channel-name').value = currentChannel.name || '';
    document.getElementById('input-edit-channel-desc').value = currentChannel.description || '';
    document.getElementById('input-edit-require-approval').checked = currentChannel.require_approval || false;
    document.getElementById('display-invite-code').textContent = currentChannel.invite_code || '-';
    loadChannelAvatarPreview();
    document.getElementById('modal-channel-settings').style.display = 'flex';
});

document.getElementById('btn-submit-edit-channel').addEventListener('click', function () {
    var name = document.getElementById('input-edit-channel-name').value.trim();
    var description = document.getElementById('input-edit-channel-desc').value.trim();
    var requireApproval = document.getElementById('input-edit-require-approval').checked;
    if (!name) { showToast('Vui lòng nhập tên kênh', 'error'); return; }
    apiCall('/channels/' + currentChannel.channel_id, 'PUT', { name: name, description: description, require_approval: requireApproval }).then(function () {
        showToast('Cập nhật kênh thành công!', 'success');
        document.getElementById('modal-channel-settings').style.display = 'none';
        selectChannel(currentChannel.channel_id);
        loadChannels();
    }).catch(function (err) {
        showToast('Lỗi cập nhật kênh: ' + err.message, 'error');
    });
});

document.getElementById('btn-delete-channel').addEventListener('click', function () {
    if (!confirm('Bạn có chắc muốn xóa kênh này?')) return;
    apiCall('/channels/' + currentChannel.channel_id, 'DELETE').then(function () {
        showToast('Đã xóa kênh', 'success');
        document.getElementById('modal-channel-settings').style.display = 'none';
        currentChannel = null;
        currentChatroom = null;
        document.getElementById('channel-empty').style.display = 'flex';
        document.getElementById('channel-detail').style.display = 'none';
        loadChannels();
        stopMemberPolling();
    }).catch(function (err) {
        showToast('Lỗi xóa kênh: ' + err.message, 'error');
    });
});

document.getElementById('btn-copy-invite-code').addEventListener('click', function () {
    var code = document.getElementById('display-invite-code').textContent;
    if (code && code !== '-') {
        navigator.clipboard.writeText(code).then(function () { showToast('Đã sao chép mã mời!', 'success'); });
    }
});

document.getElementById('btn-invite-code').addEventListener('click', function () {
    if (!currentChannel || !currentChannel.invite_code) return;
    navigator.clipboard.writeText(currentChannel.invite_code).then(function () { showToast('Đã sao chép mã mời!', 'success'); });
});

// ====== Chatroom Settings ======
document.getElementById('btn-chatroom-settings').addEventListener('click', function () {
    if (!currentChatroom) return;
    document.getElementById('input-edit-chatroom-name').value = currentChatroom.name || '';
    document.getElementById('input-edit-chatroom-desc').value = currentChatroom.description || '';
    document.getElementById('modal-chatroom-settings').style.display = 'flex';
});

document.getElementById('btn-submit-edit-chatroom').addEventListener('click', function () {
    var name = document.getElementById('input-edit-chatroom-name').value.trim();
    var description = document.getElementById('input-edit-chatroom-desc').value.trim();
    if (!name) { showToast('Vui lòng nhập tên phòng', 'error'); return; }
    apiCall('/channels/chatrooms/' + currentChatroom.room_id, 'PUT', { name: name, description: description }).then(function () {
        showToast('Cập nhật phòng chat thành công!', 'success');
        document.getElementById('modal-chatroom-settings').style.display = 'none';
        loadChatrooms(currentChannel.channel_id);
        selectChatroom(currentChatroom.room_id);
    }).catch(function (err) {
        showToast('Lỗi cập nhật phòng chat: ' + err.message, 'error');
    });
});

document.getElementById('btn-delete-chatroom').addEventListener('click', function () {
    if (!confirm('Bạn có chắc muốn xóa phòng chat này?')) return;
    apiCall('/channels/chatrooms/' + currentChatroom.room_id, 'DELETE').then(function () {
        showToast('Đã xóa phòng chat', 'success');
        document.getElementById('modal-chatroom-settings').style.display = 'none';
        currentChatroom = null;
        document.getElementById('chatroom-empty-inner').style.display = 'flex';
        document.getElementById('chatroom-active').style.display = 'none';
        loadChatrooms(currentChannel.channel_id);
    }).catch(function (err) {
        showToast('Lỗi xóa phòng chat: ' + err.message, 'error');
    });
});

// ====== Leave/Delete Channel ======
document.getElementById('btn-leave-channel').addEventListener('click', function () {
    if (!currentChannel) return;
    if (currentChannel.is_owner) {
        if (!confirm('Bạn là chủ kênh. Bạn có chắc muốn xóa kênh này?')) return;
        apiCall('/channels/' + currentChannel.channel_id, 'DELETE').then(async function () {
            await clearUserSession();
            showToast('Đã xóa kênh', 'success');
            currentChannel = null;
            currentChatroom = null;
            document.getElementById('channel-empty').style.display = 'flex';
            document.getElementById('channel-detail').style.display = 'none';
            loadChannels();
            stopChatroomPolling();
            stopMemberPolling();
        }).catch(function (err) {
            showToast('Lỗi xóa kênh: ' + err.message, 'error');
        });
    } else {
        if (!confirm('Bạn có chắc muốn rời kênh này?')) return;
        apiCall('/channels/' + currentChannel.channel_id + '/leave', 'POST').then(async function () {
            await clearUserSession();
            showToast('Đã rời kênh', 'success');
            currentChannel = null;
            currentChatroom = null;
            document.getElementById('channel-empty').style.display = 'flex';
            document.getElementById('channel-detail').style.display = 'none';
            loadChannels();
            stopChatroomPolling();
            stopMemberPolling();
        }).catch(function (err) {
            showToast('Lỗi rời kênh: ' + err.message, 'error');
        });
    }
});

// ====== Send Message ======
document.getElementById('btn-send-message').addEventListener('click', sendMessage);
document.getElementById('chat-message-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendMessage();
});

let cachedFullName = null;

async function getUserFullName() {
    if (cachedFullName) return cachedFullName;
    try {
        const email = getCurrentUserEmail();
        // Gọi API account_info (giống backend)
        const data = await apiCall(`/account/account_info?email=${email}`);
        cachedFullName = data.fullName || email.split('@')[0];
        return cachedFullName;
    } catch (e) {
        console.error("Lỗi lấy fullName:", e);
        const email = getCurrentUserEmail();
        cachedFullName = email.split('@')[0];
        return cachedFullName;
    }
}

async function sendMessage() {
    var input = document.getElementById('chat-message-input');
    var content = input.value.trim();
    if (!content || !currentChatroom) return;
    input.value = '';

    // Lấy tên người gửi
    const fullName = await getUserFullName();
    const userEmail = getCurrentUserEmail();

    // Tạo tin nhắn tạm
    const tempId = 'temp_' + Date.now() + '_' + Math.random();
    const tempMsg = {
        message_id: tempId,
        room_id: currentChatroom.room_id,
        channel_id: currentChannel.channel_id,
        sender_email: userEmail,
        sender_name: fullName,
        content: content,
        msg_type: 'text',
        created_at: new Date().toISOString()
    };

    // Thêm ngay vào UI
    messageList.push(tempMsg);
    appendNewMessages([tempMsg]);

    try {
        // Gửi tin nhắn thật
        const realMsg = await apiCall(`/channels/chatrooms/${currentChatroom.room_id}/messages`, 'POST', { content: content });

        // Thay thế tin nhắn tạm bằng tin nhắn thật
        const index = messageList.findIndex(m => m.message_id === tempId);
        if (index !== -1) {
            messageList[index] = realMsg;
            const msgDiv = document.querySelector(`.message-item[data-temp-id="${tempId}"]`);
            if (msgDiv) {
                msgDiv.setAttribute('data-message-id', realMsg.message_id);
                msgDiv.removeAttribute('data-temp-id');
                const timeSpan = msgDiv.querySelector('.message-time');
                if (timeSpan) timeSpan.textContent = formatTime(realMsg.created_at);
            }
        }
    } catch (err) {
        // Xóa tin nhắn tạm nếu lỗi
        const index = messageList.findIndex(m => m.message_id === tempId);
        if (index !== -1) {
            messageList.splice(index, 1);
            const msgDiv = document.querySelector(`.message-item[data-temp-id="${tempId}"]`);
            if (msgDiv) msgDiv.remove();
        }
        showToast('Lỗi gửi tin nhắn: ' + err.message, 'error');
        input.value = content; // khôi phục nội dung
    }
}


function updateMediaButtonsVisibility() {
    const isVoice = currentChatroom && currentChatroom.room_type === 'voice';
    const mediaGalleryBtn = document.getElementById('btn-media-gallery');
    const filesListBtn = document.getElementById('btn-files-list');
    const searchBtn = document.getElementById('btn-search-messages');

    if (mediaGalleryBtn) {
        mediaGalleryBtn.style.display = isVoice ? 'none' : 'inline-flex';
    }
    if (filesListBtn) {
        filesListBtn.style.display = isVoice ? 'none' : 'inline-flex';
    }
    if (searchBtn) {
        searchBtn.style.display = isVoice ? 'none' : 'inline-flex';
    }
}


document.getElementById('btn-media-gallery')?.addEventListener('click', async () => {
    if (!currentChatroom) return;
    const modal = document.getElementById('modal-media-files');
    const title = document.getElementById('modal-media-title');
    title.innerText = `Ảnh & Video - ${currentChatroom.name}`;
    modal.style.display = 'flex';
    const contentDiv = document.getElementById('modal-media-content');
    contentDiv.innerHTML = '<div class="loading">Đang tải...</div>';
    try {
        const data = await apiCall(`/channels/chatrooms/${currentChatroom.room_id}/media`);
        const media = data.media || [];
        if (media.length === 0) {
            contentDiv.innerHTML = '<p>Không có ảnh hoặc video nào.</p>';
            return;
        }
        let html = '<div class="media-grid">';
        for (let item of media) {
            const fileUrl = await getFileUrl(item.file_id);
            if (item.type === 'image') {
                html += `<div class="media-item"><img src="${fileUrl}" onclick="window.open('${fileUrl}')"></div>`;
            } else if (item.type === 'video') {
                html += `<div class="media-item"><video src="${fileUrl}" controls style="max-width:100%"></video></div>`;
            }
        }
        html += '</div>';
        contentDiv.innerHTML = html;
    } catch (err) {
        contentDiv.innerHTML = `<p>Lỗi: ${err.message}</p>`;
    }
});

// Hiển thị danh sách file
document.getElementById('btn-files-list')?.addEventListener('click', async () => {
    if (!currentChatroom) return;
    const modal = document.getElementById('modal-media-files');
    const title = document.getElementById('modal-media-title');
    title.innerText = `Tài liệu - ${currentChatroom.name}`;
    modal.style.display = 'flex';
    const contentDiv = document.getElementById('modal-media-content');
    contentDiv.innerHTML = '<div class="loading">Đang tải...</div>';
    try {
        const data = await apiCall(`/channels/chatrooms/${currentChatroom.room_id}/files`);
        const files = data.files || [];
        if (files.length === 0) {
            contentDiv.innerHTML = '<p>Không có tài liệu nào.</p>';
            return;
        }
        let html = '<ul class="file-list">';
        for (let item of files) {
            const fileUrl = await getFileUrl(item.file_id);
            html += `<li><i class="fas fa-file"></i> <a href="${fileUrl}" target="_blank">${escapeHtml(item.file_name)}</a> - ${escapeHtml(item.sender_name)} (${formatDate(item.created_at)})</li>`;
        }
        html += '</ul>';
        contentDiv.innerHTML = html;
    } catch (err) {
        contentDiv.innerHTML = `<p>Lỗi: ${err.message}</p>`;
    }
});

// Tìm kiếm tin nhắn
document.getElementById('btn-search-messages')?.addEventListener('click', () => {
    if (!currentChatroom) return;
    const modal = document.getElementById('modal-search');
    modal.style.display = 'flex';
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '';
});

document.getElementById('btn-do-search')?.addEventListener('click', async () => {
    const keyword = document.getElementById('search-input').value.trim();
    if (!keyword) return;
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = '<div class="loading">Đang tìm...</div>';
    try {
        const data = await apiCall(`/channels/chatrooms/${currentChatroom.room_id}/search?q=${encodeURIComponent(keyword)}`);
        const results = data.results || [];
        if (results.length === 0) {
            resultsDiv.innerHTML = '<p>Không tìm thấy tin nhắn nào.</p>';
            return;
        }
        let html = '<div class="search-results-list">';
        for (let msg of results) {
            const fileUrl = (msg.msg_type !== 'text' && msg.content) ? await getFileUrl(msg.content) : null;
            let contentHtml = '';
            if (msg.msg_type === 'image' && fileUrl) {
                contentHtml = `<img src="${fileUrl}" style="max-width:100px">`;
            } else if (msg.msg_type === 'video' && fileUrl) {
                contentHtml = `<video src="${fileUrl}" controls style="max-width:150px"></video>`;
            } else if (msg.msg_type === 'file' && fileUrl) {
                contentHtml = `<a href="${fileUrl}" target="_blank">${escapeHtml(msg.file_name)}</a>`;
            } else {
                contentHtml = escapeHtml(msg.content);
            }
            html += `<div class="search-result-item">
                        <div class="search-result-sender">${escapeHtml(msg.sender_name || msg.sender_email)}</div>
                        <div class="search-result-content">${contentHtml}</div>
                        <div class="search-result-time">${formatTime(msg.created_at)}</div>
                    </div>`;
        }
        html += '</div>';
        resultsDiv.innerHTML = html;
    } catch (err) {
        resultsDiv.innerHTML = `<p>Lỗi: ${err.message}</p>`;
    }
});


// ====== Start Meeting from Voice Room ======
document.getElementById('btn-start-meeting').addEventListener('click', function () {
    if (!currentChatroom) return;
    apiCall('/channels/chatrooms/' + currentChatroom.room_id + '/start-meeting', 'POST').then(function (data) {
        location.href = '/room.html?room=' + data.room_id;
    }).catch(function (err) {
        showToast('Lỗi tạo phòng họp: ' + err.message, 'error');
    });
});

// ====== Search ======
document.getElementById('search-channel').addEventListener('input', renderChannelList);

// ====== Modal Close ======
document.querySelectorAll('.modal-close').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var modalId = btn.getAttribute('data-modal');
        document.getElementById(modalId).style.display = 'none';
    });
});

document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.style.display = 'none';
    });
});

// ====== Init ======
// Thêm biến toàn cục để biết có đang quay về từ meeting không
function goBack() {
    window.history.back();
}


let returningFromMeeting = false;

// Trong hàm khởi tạo (sau loadChannels), thêm:
function handleUrlSelection() {
    const urlParams = new URLSearchParams(window.location.search);
    const channelId = urlParams.get('channel');
    const chatroomId = urlParams.get('chatroom');
    returningFromMeeting = urlParams.has('return');  // nếu có ?return=1
    if (channelId && chatroomId) {
        // Chờ channelList có dữ liệu rồi mới chọn
        const checkInterval = setInterval(() => {
            if (channelList.length > 0) {
                clearInterval(checkInterval);
                const channelExists = channelList.some(ch => ch.channel_id === channelId);
                if (!channelExists) {
                    // Xóa params khỏi URL
                    const url = new URL(window.location);
                    url.searchParams.delete('channel');
                    url.searchParams.delete('chatroom');
                    url.searchParams.delete('return');
                    window.history.replaceState({}, '', url);
                    return;
                }
                selectChannel(channelId).then(() => {
                    // Đợi chatroomList được load
                    setTimeout(() => {
                        if (chatroomList.length > 0) {
                            selectChatroom(chatroomId);
                        } else {
                            // fallback: load lại chatrooms
                            loadChatrooms(channelId).then(() => {
                                selectChatroom(chatroomId);
                            });
                        }
                    }, 500);
                });
            }
        }, 100);
    }
}

loadChannels();
setTimeout(handleUrlSelection, 500);
