// channel.js hoàn chỉnh (sao chép toàn bộ nội dung này)
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

            // Chỉ xóa token, giữ lại invite nếu có
            urlParams.delete('token');

            const newQuery = urlParams.toString();
            const newUrl = window.location.pathname + (newQuery ? '?' + newQuery : '');

            window.history.replaceState({}, document.title, newUrl);

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

// ====== Helper mới ======
function normalizeEmail(email) {
    return (email || '').toString().trim().toLowerCase();
}

function isCurrentUserEmail(email) {
    return normalizeEmail(email) === normalizeEmail(getCurrentUserEmail());
}

function extractErrorMessage(errorData, fallbackMessage) {
    fallbackMessage = fallbackMessage || 'Có lỗi xảy ra';

    if (!errorData) return fallbackMessage;

    if (typeof errorData === 'string') {
        return errorData;
    }

    if (typeof errorData.detail === 'string') {
        return errorData.detail;
    }

    if (errorData.detail && typeof errorData.detail === 'object') {
        if (errorData.detail.reason) return errorData.detail.reason;
        if (errorData.detail.error) return errorData.detail.error;
        if (errorData.detail.message) return errorData.detail.message;
    }

    if (errorData.reason) return errorData.reason;
    if (errorData.error) return errorData.error;
    if (errorData.message) return errorData.message;

    return fallbackMessage;
}

function showUploadErrorByStatus(status, message) {
    if (status === 503) {
        showToast(
            message || 'AI kiểm duyệt đang không khả dụng, vui lòng thử lại sau',
            'warning'
        );
        return;
    }

    if (status === 400) {
        showToast(
            message || 'File không được phép upload do vi phạm quy tắc kiểm duyệt',
            'error'
        );
        return;
    }

    showToast(message || 'Upload thất bại', 'error');
}

function moderationActionLabel(action) {
    switch (action) {
        case 'warn':
            return 'cảnh báo';
        case 'mute':
            return 'cấm gửi tin nhắn';
        case 'kick':
            return 'mời khỏi kênh';
        case 'ban':
            return 'cấm khỏi kênh';
        default:
            return action || 'xử lý';
    }
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
            const errorData = await res.json().catch(() => ({}));
            const errorMsg = extractErrorMessage(errorData, `HTTP ${res.status}`);
            const error = new Error(errorMsg);
            error.status = res.status;
            error.data = errorData;
            throw error;
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
var memberPollingTimer = null;
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

let channelAvatarCache = {};
async function getChannelAvatarUrl(fileId) {
    if (!fileId) return null;
    if (channelAvatarCache[fileId]) return channelAvatarCache[fileId];
    try {
        const data = await apiCall(`/channels/files/${fileId}`);
        channelAvatarCache[fileId] = data.url;
        return data.url;
    } catch (err) {
        console.error('Failed to get channel avatar URL:', err);
        return null;
    }
}

// Avatar update UI functions
async function updateChannelAvatarInUI() {
    const avatarContainer = document.getElementById('channel-avatar');
    if (!avatarContainer) return;
    if (currentChannel && currentChannel.avatar) {
        let url = await getChannelAvatarUrl(currentChannel.avatar);
        if (url) {
            avatarContainer.innerHTML = `<img src="${url}" class="channel-avatar-img" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`;
        } else {
            avatarContainer.innerHTML = '<i class="fas fa-hashtag"></i>';
        }
    } else {
        avatarContainer.innerHTML = '<i class="fas fa-hashtag"></i>';
    }
}
async function loadChannelAvatarPreview() {
    const img = document.getElementById('channel-avatar-preview');
    const placeholder = document.getElementById('channel-avatar-placeholder');
    if (!currentChannel || !currentChannel.avatar) {
        if (img) img.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
    } else {
        let url = await getChannelAvatarUrl(currentChannel.avatar);
        if (url && img) {
            img.src = url;
            img.style.display = 'block';
            placeholder.style.display = 'none';
        } else if (img) {
            img.style.display = 'none';
            if (placeholder) placeholder.style.display = 'flex';
        }
    }
}

// Avatar upload listeners
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
        currentChannel.avatar = data.file_id;
        if (data.file_id) {
            if (currentChannel.avatar && currentChannel.avatar !== data.file_id) {
                delete channelAvatarCache[currentChannel.avatar];
            }
            await loadChannelAvatarPreview();
            await updateChannelAvatarInUI();
            renderChannelList();
            showToast('Cập nhật ảnh đại diện thành công', 'success');
        }
    } catch (err) {
        showToast('Lỗi upload: ' + err.message, 'error');
    }
});
document.getElementById('btn-remove-avatar')?.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc muốn xóa ảnh đại diện?')) return;
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/channels/${currentChannel.channel_id}/avatar`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Delete failed');
        if (currentChannel.avatar) delete channelAvatarCache[currentChannel.avatar];
        currentChannel.avatar = null;
        loadChannelAvatarPreview();
        updateChannelAvatarInUI();
        renderChannelList();
        showToast('Đã xóa ảnh đại diện', 'success');
    } catch (err) {
        showToast('Lỗi xóa ảnh: ' + err.message, 'error');
    }
});

var unreadCounts = {};
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
    channelPollingTimer = setInterval(() => { loadChannels(); }, 2000);
}
function stopChannelPolling() {
    if (channelPollingTimer) { clearInterval(channelPollingTimer); channelPollingTimer = null; }
}
function startChatroomPolling() {
    if (chatroomPollingTimer) clearInterval(chatroomPollingTimer);
    chatroomPollingTimer = setInterval(() => {
        if (currentChannel) loadChatrooms(currentChannel.channel_id);
    }, 2000);
}
function stopChatroomPolling() {
    if (chatroomPollingTimer) { clearInterval(chatroomPollingTimer); chatroomPollingTimer = null; }
}

var token = getToken();
if (!token) throw new Error("Redirecting to login...");

// WebSocket
let channelSocket = null;
function connectChannelWebsocket(channelId) {
    if (channelSocket) { channelSocket.close(); channelSocket = null; }
    const token = getToken();
    if (!token) return;
    const wsUrl = `ws://localhost:8000/channels/ws/${channelId}?token=${token}`;
    channelSocket = new WebSocket(wsUrl);
    channelSocket.onopen = () => {
        console.log('Channel WebSocket connected');
        // Kiểm tra channelSocket vẫn là websocket hiện tại và đang mở
        if (channelSocket && channelSocket.readyState === WebSocket.OPEN) {
            channelSocket.send(JSON.stringify({ type: 'ping' }));
        }
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
                        currentChannel = null; currentChatroom = null;
                        document.getElementById('channel-empty').style.display = 'flex';
                        document.getElementById('channel-detail').style.display = 'none';
                    }
                    loadChannels();
                    break;
                case 'chatroom_created':
                    if (currentChannel && currentChannel.channel_id === data.chatroom.channel_id) {
                        chatroomList.push(data.chatroom);
                        renderChatroomList();
                        showToast(`Phòng "${data.chatroom.name}" đã được tạo`, 'success');
                    }
                    break;
                case 'chatroom_deleted':
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
                    const currentEmail = getCurrentUserEmail();
                    if (data.member.email === currentEmail) {
                        showToast('Bạn đã được chấp nhận tham gia kênh!', 'success');
                        loadChannels();
                    } else if (currentChannel && currentChannel.channel_id === data.member.channel_id) {
                        loadMembers(currentChannel.channel_id);
                    }
                    break;
                case 'member_kicked':
                    console.log('[WS] member_kicked:', data);

                    if (isCurrentUserEmail(data.member_email)) {
                        showToast('Bạn đã bị kick khỏi kênh này', 'error');

                        currentChannel = null;
                        currentChatroom = null;
                        messageList = [];
                        memberList = [];

                        if (channelSocket) {
                            channelSocket.close();
                            channelSocket = null;
                        }

                        document.getElementById('channel-empty').style.display = 'flex';
                        document.getElementById('channel-detail').style.display = 'none';

                        loadChannels();

                        break;
                    }

                    if (currentChannel && currentChannel.channel_id === data.channel_id) {
                        memberList = memberList.filter(m => normalizeEmail(m.email) !== normalizeEmail(data.member_email));
                        renderMembers();

                        const memberCountEl = document.getElementById('member-count');
                        if (memberCountEl) {
                            memberCountEl.innerHTML = '<i class="fas fa-users"></i> <span>' + memberList.length + '</span>';
                        }

                        showToast(`${data.member_email} đã bị kick khỏi kênh`, 'warning');
                    }

                    break;
                case 'channel_avatar_updated':
                    if (currentChannel && currentChannel.channel_id === data.channel_id) {
                        const oldFileId = currentChannel.avatar;
                        currentChannel.avatar = data.file_id;
                        if (oldFileId && oldFileId !== data.file_id) delete channelAvatarCache[oldFileId];
                        if (data.file_id) delete channelAvatarCache[data.file_id];
                        updateChannelAvatarInUI();
                        loadChannelAvatarPreview();
                        renderChannelList();
                    }
                    break;
                case 'message_removed':
                    console.log('[WS] message_removed:', data);

                    messageList = messageList.filter(m => m.message_id !== data.message_id);

                    if (currentChatroom && data.room_id === currentChatroom.room_id) {
                        const msgEl = document.querySelector(
                            `.message-item[data-message-id="${data.message_id}"]`
                        );

                        if (msgEl) {
                            msgEl.remove();
                        } else {
                            await renderMessages();
                        }
                    }

                    if (isCurrentUserEmail(data.user_email)) {
                        showToast(
                            `⚠️ Nội dung của bạn đã bị gỡ: ${data.reason || 'Vi phạm quy tắc kiểm duyệt'}`,
                            'warning'
                        );
                    }

                    break;
                case 'user_warning':
                    console.log('[WS] user_warning:', data);

                    if (isCurrentUserEmail(data.user_email)) {
                        const remaining = Number(data.remaining ?? 0);
                        const reason = data.reason || 'Vi phạm quy tắc kiểm duyệt';

                        if (remaining > 0) {
                            showToast(
                                `⚠️ Cảnh báo: ${reason}. Bạn còn ${remaining} lần vi phạm trước khi bị ${moderationActionLabel(data.action)}.`,
                                'warning'
                            );
                        } else {
                            showToast(
                                `⚠️ Cảnh báo: ${reason}.`,
                                'warning'
                            );
                        }
                    }

                    break;
                case 'user_violation':
                    console.log('[WS] user_violation:', data);

                    if (isCurrentUserEmail(data.user_email)) {
                        const actionLabel = moderationActionLabel(data.action);
                        const reason = data.reason || 'Vi phạm quy tắc kiểm duyệt';

                        showToast(
                            `❌ Bạn đã bị ${actionLabel}: ${reason}`,
                            'error'
                        );

                        if (data.action === 'kick' || data.action === 'ban') {
                            setTimeout(() => location.reload(), 1200);
                        } else if (data.action === 'mute') {
                            const input = document.getElementById('chat-message-input');
                            const sendBtn = document.getElementById('btn-send-message');

                            if (input) {
                                input.disabled = true;
                                input.placeholder = 'Bạn đang bị cấm gửi tin nhắn';
                            }

                            if (sendBtn) {
                                sendBtn.disabled = true;
                            }
                        }
                    }

                    break;
                default: console.log('Unknown event type:', data.type);
            }
        } catch (err) { console.error('WebSocket message error:', err); }
    };
    channelSocket.onerror = (error) => { console.error('WebSocket error:', error); };
    channelSocket.onclose = () => { console.log('❌ WebSocket closed:', event.code, event.reason); channelSocket = null; };
}

document.getElementById('channel-loading').style.display = 'none';
document.getElementById('channel-app').style.display = 'flex';

function loadChannels() {
    apiCall('/channels/my-channels').then(function (data) {
        channelList = data.channels || data || [];
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
    var filtered = channelList.filter(ch => ch.name.toLowerCase().indexOf(searchTerm) !== -1);
    var html = '';
    filtered.forEach(ch => {
        var isActive = currentChannel && currentChannel.channel_id === ch.channel_id ? ' active' : '';
        var avatarHtml = '<i class="fas fa-hashtag"></i>';
        if (ch.avatar) {
            var cachedUrl = channelAvatarCache[ch.avatar];
            if (cachedUrl) {
                avatarHtml = `<img src="${cachedUrl}" class="channel-avatar-img" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`;
            } else {
                avatarHtml = '<i class="fas fa-spinner fa-spin"></i>';
                getChannelAvatarUrl(ch.avatar).then(url => {
                    if (url) { channelAvatarCache[ch.avatar] = url; renderChannelList(); }
                    else { channelAvatarCache[ch.avatar] = null; renderChannelList(); }
                });
            }
        }
        var unread = unreadChannelCounts[ch.channel_id] || 0;
        var unreadBadge = unread > 0 ? '<span class="unread-badge"></span>' : '';
        var channelNameClass = unread > 0 ? 'channel-item-name unread' : 'channel-item-name';
        html += `<div class="channel-item${isActive}" data-id="${ch.channel_id}" onclick="selectChannel('${ch.channel_id}')">
            <div class="channel-item-avatar">${avatarHtml}</div>
            <div class="channel-item-info">
                <div class="${channelNameClass}">${escapeHtml(ch.name)}${unreadBadge}</div>
                <div class="channel-item-desc">${escapeHtml(ch.description || '')}</div>
            </div>
        </div>`;
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
    if (createChatroomBtn) createChatroomBtn.style.display = isOwner ? 'inline-flex' : 'none';
    if (channelSettingsBtn) channelSettingsBtn.style.display = isOwner ? 'inline-flex' : 'none';
    if (chatroomSettingsBtn) chatroomSettingsBtn.style.display = (isOwner && currentChatroom) ? 'inline-flex' : 'none';
}

async function selectChannel(channelId) {
    apiCall('/channels/' + channelId).then(async function (data) {
        currentChannel = data;
        currentChatroom = null;
        messageList = [];
        stopMessagePolling();
        stopMemberPolling();
        updateOwnerControls();

        const emptyInner = document.getElementById('chatroom-empty-inner');
        const activeDiv = document.getElementById('chatroom-active');
        if (emptyInner) emptyInner.style.display = 'flex';
        if (activeDiv) activeDiv.style.display = 'none';
        const messagesContainer = document.getElementById('chatroom-messages');
        if (messagesContainer) messagesContainer.innerHTML = '';

        await setUserSession(channelId, null);
        connectChannelWebsocket(channelId);
        await renderChannelDetail();
        renderChannelList();
        await loadChatrooms(channelId);
        await loadUnreadCounts(channelId);
        await loadChannelRules();
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

async function renderChannelDetail() {
    document.getElementById('channel-empty').style.display = 'none';
    document.getElementById('channel-detail').style.display = 'flex';

    const avatarContainer = document.getElementById('channel-avatar');
    if (avatarContainer) {
        if (currentChannel.avatar) {
            let url = await getChannelAvatarUrl(currentChannel.avatar);
            if (url) avatarContainer.innerHTML = `<img src="${url}" class="channel-avatar-img" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`;
            else avatarContainer.innerHTML = '<i class="fas fa-hashtag"></i>';
        } else {
            avatarContainer.innerHTML = '<i class="fas fa-hashtag"></i>';
        }
    }

    document.getElementById('channel-name').textContent = currentChannel.name;
    document.getElementById('channel-description').textContent = currentChannel.description || 'Không có mô tả';
    const memberCount = currentChannel.member_count || (memberList ? memberList.length : 0);
    document.getElementById('member-count').innerHTML = '<i class="fas fa-users"></i> <span>' + memberCount + '</span>';

    const leaveBtn = document.getElementById('btn-leave-channel');
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
    if (!chatroomList.length) { container.innerHTML = '<div class="empty-chatrooms">Chưa có phòng chat nào</div>'; return; }
    var textRooms = chatroomList.filter(r => r.room_type === 'text' || !r.room_type);
    var voiceRooms = chatroomList.filter(r => r.room_type === 'voice');
    var html = '';
    if (textRooms.length) {
        html += '<div class="chatroom-group"><div class="chatroom-group-title"><i class="fas fa-hashtag"></i> Trò chuyện</div>';
        textRooms.forEach(r => {
            var isActive = currentChatroom && currentChatroom.room_id === r.room_id ? ' active' : '';
            var unread = unreadCounts[r.room_id] || 0;
            var unreadBadge = unread > 0 ? '<span class="unread-badge"></span>' : '';
            html += `<div class="chatroom-item${isActive}" onclick="selectChatroom('${r.room_id}')">
                <span class="chatroom-item-icon"><i class="fas fa-hashtag"></i></span>
                <span class="chatroom-item-name">${escapeHtml(r.name)}</span>${unreadBadge}
            </div>`;
        });
        html += '</div>';
    }
    if (voiceRooms.length) {
        html += '<div class="chatroom-group"><div class="chatroom-group-title"><i class="fas fa-volume-up"></i> Họp</div>';
        voiceRooms.forEach(r => {
            var isActive = currentChatroom && currentChatroom.room_id === r.room_id ? ' active' : '';
            var unread = unreadCounts[r.room_id] || 0;
            var unreadBadge = unread > 0 ? '<span class="unread-badge">*</span>' : '';
            var roomNameClass = unread > 0 ? 'chatroom-item-name unread' : 'chatroom-item-name';
            html += `<div class="chatroom-item${isActive}" onclick="selectChatroom('${r.room_id}')">
                <span class="chatroom-item-icon"><i class="fas fa-volume-up"></i></span>
                <span class="${roomNameClass}">${escapeHtml(r.name)}${unreadBadge}</span>
            </div>`;
        });
        html += '</div>';
    }
    container.innerHTML = html;
}

// ====== Select Chatroom ======
function selectChatroom(roomId) {
    function applyRoom(room) {
        currentChatroom = room;
        updateOwnerControls();
        messageList = [];
        renderChatroomActive();
        renderChatroomList();
        if (currentChatroom.room_type === 'voice') {
            stopMessagePolling();
            renderVoiceRoom();
        } else {
            refreshMessages();
        }
    }
    apiCall(`/channels/chatrooms/${roomId}/mark-read`, 'POST').catch(console.error);
    if (unreadCounts[roomId]) {
        delete unreadCounts[roomId];
        renderChatroomList();
    }
    if (chatroomList.length > 0) {
        let found = chatroomList.find(r => String(r.room_id) === String(roomId));
        if (found) { applyRoom(found); return; }
        console.warn('Room not in list, fetching from API');
        apiCall('/channels/chatrooms/' + roomId).then(room => applyRoom(room)).catch(err => applyRoom({ room_id: roomId, name: 'Phòng chat', room_type: 'text' }));
    } else {
        apiCall('/channels/chatrooms/' + roomId).then(room => applyRoom(room)).catch(err => applyRoom({ room_id: roomId, name: 'Phòng chat', room_type: 'text' }));
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
    if (typeIconEl) typeIconEl.innerHTML = currentChatroom.room_type === 'voice' ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-hashtag"></i>';
    const startBtn = document.getElementById('btn-start-meeting');
    if (startBtn) startBtn.style.display = 'none';
    updateMediaButtonsVisibility();
}

function renderVoiceRoom() {
    var messagesContainer = document.getElementById('chatroom-messages');
    if (!messagesContainer) return;
    var inputArea = document.querySelector('.chatroom-input-area');
    if (inputArea) inputArea.style.display = 'none';
    messagesContainer.innerHTML = '';
    var html = '<div class="voice-room"><div class="voice-room-header"><i class="fas fa-volume-up" style="font-size:48px;color:#323cae;"></i><h3>' + escapeHtml(currentChatroom.name) + '</h3><p>' + escapeHtml(currentChatroom.description || 'Phòng họp') + '</p></div><div class="voice-room-actions"><button class="btn-join-voice" id="btn-join-voice" onclick="joinVoiceRoom()"><i class="fas fa-headphones"></i> Tham gia họp</button></div></div>';
    messagesContainer.innerHTML = html;
}

var isInVoiceRoom = false;
function joinVoiceRoom() {
    if (!currentChatroom) return;
    sessionStorage.setItem('lastVoiceChannel', currentChannel.channel_id);
    sessionStorage.setItem('lastVoiceRoom', currentChatroom.room_id);
    apiCall('/channels/chatrooms/' + currentChatroom.room_id + '/start-meeting', 'POST').then(data => {
        location.href = `/room.html?room=${data.room_id}&channel=${currentChannel.channel_id}&chatroom=${currentChatroom.room_id}`;
    }).catch(err => showToast('Lỗi tham gia phòng họp: ' + err.message, 'error'));
}

async function appendNewMessages(newMessages) {
    const container = document.getElementById('chatroom-messages');
    if (!container || !newMessages || newMessages.length === 0) return;

    // Xóa dòng "chưa có tin nhắn" nếu đang hiển thị
    const noMessagesEl = container.querySelector('.no-messages');
    if (noMessagesEl) noMessagesEl.remove();

    // Lấy avatar cho các sender chưa có cache
    for (let msg of newMessages) {
        if (msg.sender_email && !avatarCache[msg.sender_email]) {
            await getUserAvatar(msg.sender_email);
        }
    }

    // Lấy URL cho file/image/video chưa có cache
    const fileMessages = newMessages.filter(m =>
        m.msg_type !== 'text' &&
        m.content &&
        !fileUrlCache[m.content]
    );

    for (let msg of fileMessages) {
        try {
            const urlData = await apiCall(`/channels/files/${msg.content}`);
            fileUrlCache[msg.content] = urlData.url;
        } catch (err) {
            console.error(`Lỗi lấy URL cho ${msg.content}:`, err);
            fileUrlCache[msg.content] = null;
        }
    }

    const wasAtBottom = (container.scrollHeight - container.scrollTop) <= (container.clientHeight + 50);

    let html = '';

    // Tìm ngày cuối cùng đang hiển thị để append separator đúng
    let currentDate = '';
    const separators = container.querySelectorAll('.message-date-separator span');
    if (separators.length > 0) {
        currentDate = separators[separators.length - 1].textContent;
    }

    newMessages.forEach(msg => {
        // Nếu DOM đã có message này rồi thì bỏ qua
        if (msg.message_id) {
            const existed = container.querySelector(`.message-item[data-message-id="${msg.message_id}"]`);
            if (existed) return;
        }

        const msgDate = formatDate(msg.created_at);

        if (msgDate !== currentDate) {
            currentDate = msgDate;
            html += `<div class="message-date-separator"><span>${msgDate}</span></div>`;
        }

        const isOwn = msg.sender_email === getCurrentUserEmail();
        const msgType = msg.msg_type || 'text';
        const fileUrl = (msgType !== 'text' && msg.content && fileUrlCache[msg.content])
            ? fileUrlCache[msg.content]
            : null;

        let contentHtml = '';

        if (msgType === 'image') {
            contentHtml = fileUrl
                ? `<img src="${fileUrl}" style="max-width:250px; max-height:250px; border-radius:8px; cursor:pointer;" onclick="window.open('${fileUrl}')" />`
                : '<span class="file-placeholder">Đang tải ảnh...</span>';
        } else if (msgType === 'video') {
            contentHtml = fileUrl
                ? `<video src="${fileUrl}" controls style="max-width:250px; border-radius:8px;"></video>`
                : '<span class="file-placeholder">Đang tải video...</span>';
        } else if (msgType === 'file') {
            if (fileUrl) {
                const fileName = msg.file_name || 'Tải file';
                const ext = (fileName.split('.').pop() || '').toLowerCase();

                let icon = '<i class="fas fa-paperclip"></i>';
                if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                    icon = '<i class="fas fa-file-image"></i>';
                } else if (['mp4', 'webm', 'mov'].includes(ext)) {
                    icon = '<i class="fas fa-file-video"></i>';
                } else if (['pdf'].includes(ext)) {
                    icon = '<i class="fas fa-file-pdf"></i>';
                } else if (['doc', 'docx'].includes(ext)) {
                    icon = '<i class="fas fa-file-word"></i>';
                } else if (['xls', 'xlsx'].includes(ext)) {
                    icon = '<i class="fas fa-file-excel"></i>';
                } else if (['zip', 'rar', '7z'].includes(ext)) {
                    icon = '<i class="fas fa-file-archive"></i>';
                }

                contentHtml = `
                    <a href="${fileUrl}" target="_blank" style="color:#323cae; text-decoration:none;">
                        ${icon} ${escapeHtml(fileName)}
                    </a>
                `;
            } else {
                contentHtml = '<span class="file-placeholder">Đang tải file...</span>';
            }
        } else {
            contentHtml = escapeHtml(msg.content || '');
        }

        const avatarUrl = avatarCache[msg.sender_email];
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" class="message-avatar-img" onerror="this.onerror=null;this.style.display='none';this.nextSibling.style.display='flex'">`
            : '';

        const letterHtml = `
            <div class="message-avatar-letter" style="${avatarUrl ? 'display:none' : 'display:flex'}">
                ${getAvatarLetter(msg.sender_name || msg.sender_email)}
            </div>
        `;

        const messageIdAttr = msg.message_id ? `data-message-id="${msg.message_id}"` : '';
        const tempIdAttr = msg.message_id && msg.message_id.startsWith('temp_')
            ? `data-temp-id="${msg.message_id}"`
            : '';

        html += `
            <div class="message-item${isOwn ? ' own' : ''}" ${messageIdAttr} ${tempIdAttr}>
                <div class="message-avatar">${avatarHtml}${letterHtml}</div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-sender">${escapeHtml(msg.sender_name || msg.sender_email)}</span>
                        <span class="message-time">${formatTime(msg.created_at)}</span>
                    </div>
                    <div class="message-text">${contentHtml}</div>
                </div>
            </div>
        `;
    });

    if (html.trim()) {
        container.insertAdjacentHTML('beforeend', html);
    }

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
        const fileMessages = newMessages.filter(m => m.msg_type !== 'text');
        for (let msg of fileMessages) {
            if (msg.content && !fileUrlCache[msg.content]) {
                try { const urlData = await apiCall(`/channels/files/${msg.content}`); fileUrlCache[msg.content] = urlData.url; }
                catch (err) { console.error(`Lỗi lấy URL cho ${msg.content}:`, err); fileUrlCache[msg.content] = null; }
            }
        }
        if (messageList.length === 0) { messageList = newMessages; renderMessages(); return; }
        const existingIds = new Set(messageList.map(m => m.message_id));
        const addedMessages = newMessages.filter(m => !existingIds.has(m.message_id));
        if (addedMessages.length > 0) { messageList.push(...addedMessages); appendNewMessages(addedMessages); }
    } catch (err) { console.error('Load messages error:', err); }
}

async function renderMessages() {
    if (!currentChatroom) return;

    const container = document.getElementById('chatroom-messages');
    if (!container) return;

    // Lấy avatar cho các sender chưa có cache
    for (let msg of messageList) {
        if (msg.sender_email && !avatarCache[msg.sender_email]) {
            await getUserAvatar(msg.sender_email);
        }
    }

    // Lấy URL cho các file/image/video chưa có cache
    const fileMessages = messageList.filter(m =>
        m.msg_type !== 'text' &&
        m.content &&
        !fileUrlCache[m.content]
    );

    for (let msg of fileMessages) {
        try {
            const urlData = await apiCall(`/channels/files/${msg.content}`);
            fileUrlCache[msg.content] = urlData.url;
        } catch (err) {
            console.error(`Lỗi lấy URL cho ${msg.content}:`, err);
            fileUrlCache[msg.content] = null;
        }
    }

    const inputArea = document.querySelector('.chatroom-input-area');
    if (inputArea && currentChatroom && currentChatroom.room_type !== 'voice') {
        inputArea.style.display = 'flex';
    }

    const savedScrollTop = container.scrollTop;
    const wasAtBottom = (container.scrollHeight - savedScrollTop) <= (container.clientHeight + 50);

    let html = `
        <div class="chat-welcome">
            <i class="fas fa-hashtag" style="font-size:40px;color:#323cae;"></i>
            <h3>Chào mừng đến <span id="welcome-room-name">${escapeHtml(currentChatroom.name)}</span></h3>
        </div>
    `;

    if (!messageList || messageList.length === 0) {
        html += '<div class="no-messages">Chưa có tin nhắn nào. Hãy gửi tin nhắn đầu tiên!</div>';
    } else {
        let currentDate = '';

        messageList.forEach(msg => {
            const msgDate = formatDate(msg.created_at);

            if (msgDate !== currentDate) {
                currentDate = msgDate;
                html += `<div class="message-date-separator"><span>${msgDate}</span></div>`;
            }

            const isOwn = msg.sender_email === getCurrentUserEmail();
            const msgType = msg.msg_type || 'text';
            const fileUrl = (msgType !== 'text' && msg.content && fileUrlCache[msg.content])
                ? fileUrlCache[msg.content]
                : null;

            let contentHtml = '';

            if (msgType === 'image') {
                contentHtml = fileUrl
                    ? `<img src="${fileUrl}" style="max-width:250px; max-height:250px; border-radius:8px; cursor:pointer;" onclick="window.open('${fileUrl}')" />`
                    : '<span class="file-placeholder">Đang tải ảnh...</span>';
            } else if (msgType === 'video') {
                contentHtml = fileUrl
                    ? `<video src="${fileUrl}" controls style="max-width:250px; border-radius:8px;"></video>`
                    : '<span class="file-placeholder">Đang tải video...</span>';
            } else if (msgType === 'file') {
                if (fileUrl) {
                    const fileName = msg.file_name || 'Tải file';
                    const ext = (fileName.split('.').pop() || '').toLowerCase();

                    let icon = '<i class="fas fa-paperclip"></i>';
                    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                        icon = '<i class="fas fa-file-image"></i>';
                    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
                        icon = '<i class="fas fa-file-video"></i>';
                    } else if (['pdf'].includes(ext)) {
                        icon = '<i class="fas fa-file-pdf"></i>';
                    } else if (['doc', 'docx'].includes(ext)) {
                        icon = '<i class="fas fa-file-word"></i>';
                    } else if (['xls', 'xlsx'].includes(ext)) {
                        icon = '<i class="fas fa-file-excel"></i>';
                    } else if (['zip', 'rar', '7z'].includes(ext)) {
                        icon = '<i class="fas fa-file-archive"></i>';
                    }

                    contentHtml = `
                        <a href="${fileUrl}" target="_blank" style="color:#323cae; text-decoration:none;">
                            ${icon} ${escapeHtml(fileName)}
                        </a>
                    `;
                } else {
                    contentHtml = '<span class="file-placeholder">Đang tải file...</span>';
                }
            } else {
                contentHtml = escapeHtml(msg.content || '');
            }

            const avatarUrl = avatarCache[msg.sender_email];
            const avatarHtml = avatarUrl
                ? `<img src="${avatarUrl}" class="message-avatar-img" onerror="this.onerror=null;this.style.display='none';this.nextSibling.style.display='flex'">`
                : '';

            const letterHtml = `
                <div class="message-avatar-letter" style="${avatarUrl ? 'display:none' : 'display:flex'}">
                    ${getAvatarLetter(msg.sender_name || msg.sender_email)}
                </div>
            `;

            const messageIdAttr = msg.message_id ? `data-message-id="${msg.message_id}"` : '';
            const tempIdAttr = msg.message_id && msg.message_id.startsWith('temp_')
                ? `data-temp-id="${msg.message_id}"`
                : '';

            html += `
                <div class="message-item${isOwn ? ' own' : ''}" ${messageIdAttr} ${tempIdAttr}>
                    <div class="message-avatar">${avatarHtml}${letterHtml}</div>
                    <div class="message-content">
                        <div class="message-header">
                            <span class="message-sender">${escapeHtml(msg.sender_name || msg.sender_email)}</span>
                            <span class="message-time">${formatTime(msg.created_at)}</span>
                        </div>
                        <div class="message-text">${contentHtml}</div>
                    </div>
                </div>
            `;
        });
    }

    container.innerHTML = html;

    setTimeout(() => {
        if (wasAtBottom) {
            container.scrollTop = container.scrollHeight;
        } else if (savedScrollTop <= container.scrollHeight) {
            container.scrollTop = savedScrollTop;
        } else {
            container.scrollTop = container.scrollHeight;
        }
    }, 0);
}

async function refreshMessages() {
    if (!currentChatroom) return;
    try {
        const data = await apiCall('/channels/chatrooms/' + currentChatroom.room_id + '/messages?limit=50');
        const newMessages = data.messages || [];
        for (let msg of newMessages) {
            if (msg.msg_type !== 'text' && msg.content && !fileUrlCache[msg.content]) {
                try { const urlData = await apiCall(`/channels/files/${msg.content}`); fileUrlCache[msg.content] = urlData.url; }
                catch (err) { console.error(`Lỗi lấy URL cho ${msg.content}:`, err); fileUrlCache[msg.content] = null; }
            }
        }
        messageList = newMessages;
        await renderMessages();
    } catch (err) { console.error('Refresh messages error:', err); showToast('Không thể tải tin nhắn', 'error'); }
}

function getCurrentUserEmail() {
    try { var token = getToken(); if (!token) return ''; var payload = JSON.parse(atob(token.split('.')[1])); return payload.sub || ''; }
    catch (e) { return ''; }
}
function getAvatarLetter(name) { if (!name) return '?'; var parts = name.trim().split(/\s+/); if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase(); return name[0].toUpperCase(); }
function formatTime(dateStr) { if (!dateStr) return ''; var d = new Date(dateStr); var hours = d.getHours().toString().padStart(2, '0'); var mins = d.getMinutes().toString().padStart(2, '0'); return hours + ':' + mins; }
function formatDate(dateStr) { if (!dateStr) return ''; var d = new Date(dateStr); var today = new Date(); var yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1); if (d.toDateString() === today.toDateString()) return 'Hôm nay'; if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua'; var day = d.getDate().toString().padStart(2, '0'); var month = (d.getMonth() + 1).toString().padStart(2, '0'); var year = d.getFullYear(); return day + '/' + month + '/' + year; }

function startMessagePolling() { stopMessagePolling(); }
function stopMessagePolling() { if (messagePollingTimer) { clearInterval(messagePollingTimer); messagePollingTimer = null; } }

async function setUserSession(channelId, chatRoomId) {
    try { let url = `/channels/session/set?channel_id=${encodeURIComponent(channelId || '')}`; if (chatRoomId) url += `&chat_room_id=${encodeURIComponent(chatRoomId)}`; await apiCall(url, 'POST'); console.log('Session set successfully', { channelId, chatRoomId }); }
    catch (err) { console.error('Set session error:', err); }
}
async function clearUserSession() {
    try { await apiCall('/channels/session/clear', 'POST'); stopChatroomPolling(); if (channelSocket) { channelSocket.close(); channelSocket = null; } }
    catch (err) { console.error('Clear session error:', err); }
}
window.addEventListener('beforeunload', () => { if (currentChannel) clearUserSession(); });

async function loadMembers(channelId) {
    if (!channelId) return;
    try {
        const membersData = await apiCall('/channels/' + channelId + '/members');
        const allMembers = membersData.members || membersData || [];
        const onlineData = await apiCall('/channels/' + channelId + '/online-users');
        const onlineEmails = (onlineData.online_users || []).map(u => u.email);
        memberList = allMembers.map(m => ({ ...m, is_online: onlineEmails.includes(m.email), avatar: m.avatar || null }));
        renderMembers();
        if (currentChannel && currentChannel.channel_id === channelId) document.getElementById('member-count').innerHTML = '<i class="fas fa-users"></i> <span>' + memberList.length + '</span>';
    } catch (err) { console.error('Load members error:', err); memberList = []; renderMembers(); }
}
function startMemberPolling(channelId) { stopMemberPolling(); if (!channelId) return; memberPollingTimer = setInterval(() => { if (currentChannel && currentChannel.channel_id === channelId) loadMembers(channelId); }, 5000); }
function stopMemberPolling() { if (memberPollingTimer) { clearInterval(memberPollingTimer); memberPollingTimer = null; } }

function renderMembers() {
    var onlineList = document.getElementById('online-members-list');
    var offlineList = document.getElementById('offline-members-list');
    var pendingSection = document.getElementById('members-pending');
    var pendingList = document.getElementById('pending-members-list');

    if (!onlineList || !offlineList || !pendingSection || !pendingList) return;

    var onlineMembers = memberList.filter(m => m.is_online && m.status !== 'pending');
    var offlineMembers = memberList.filter(m => !m.is_online && m.status !== 'pending');
    var pendingMembers = memberList.filter(m => m.status === 'pending');

    onlineList.innerHTML =
        onlineMembers.map(m => renderMemberItem(m)).join('') ||
        '<div class="no-members">Không có</div>';

    offlineList.innerHTML =
        offlineMembers.map(m => renderMemberItem(m)).join('') ||
        '<div class="no-members">Không có</div>';

    if (pendingMembers.length > 0 && currentChannel && currentChannel.is_owner) {
        pendingSection.style.display = 'block';

        pendingList.innerHTML = pendingMembers.map(m => {
            const rawEmail = m.email || '';
            const safeEmail = escapeHtml(rawEmail);
            const username = escapeHtml(m.username || rawEmail || 'User');

            return `
                <div 
                    class="member-item pending pending-member-row" 
                    data-email="${safeEmail}"
                    style="
                        display:flex !important;
                        align-items:center !important;
                        gap:8px !important;
                        width:100% !important;
                        min-width:0 !important;
                        overflow:visible !important;
                        box-sizing:border-box !important;
                    "
                >
                    <div 
                        class="member-avatar"
                        style="
                            flex:0 0 36px !important;
                            width:36px !important;
                            height:36px !important;
                        "
                    >
                        <i class="fas fa-user-clock"></i>
                    </div>

                    <div 
                        class="member-info"
                        style="
                            flex:1 1 auto !important;
                            min-width:0 !important;
                            overflow:hidden !important;
                        "
                    >
                        <span 
                            class="member-name"
                            style="
                                display:block !important;
                                white-space:nowrap !important;
                                overflow:hidden !important;
                                text-overflow:ellipsis !important;
                            "
                        >${username}</span>

                        <span 
                            class="member-role"
                            style="
                                display:block !important;
                                white-space:nowrap !important;
                            "
                        >Chờ duyệt</span>
                    </div>

                    <div 
                        class="pending-actions"
                        style="
                            flex:0 0 auto !important;
                            display:flex !important;
                            align-items:center !important;
                            justify-content:flex-end !important;
                            gap:6px !important;
                            overflow:visible !important;
                            white-space:nowrap !important;
                        "
                    >
                        <button 
                            type="button"
                            class="pending-accept-btn"
                            title="Chấp nhận"
                            onclick="event.stopPropagation(); approveMember('${rawEmail.replace(/'/g, "\\'")}')"
                            style="
                                display:inline-flex !important;
                                align-items:center !important;
                                justify-content:center !important;
                                width:32px !important;
                                height:32px !important;
                                min-width:32px !important;
                                border:none !important;
                                border-radius:50% !important;
                                background:#2ecc71 !important;
                                color:white !important;
                                cursor:pointer !important;
                                padding:0 !important;
                                margin:0 !important;
                                flex:0 0 32px !important;
                            "
                        >
                            <i class="fas fa-check"></i>
                        </button>

                        <button 
                            type="button"
                            class="pending-reject-btn"
                            title="Từ chối"
                            onclick="event.stopPropagation(); rejectMember('${rawEmail.replace(/'/g, "\\'")}')"
                            style="
                                display:inline-flex !important;
                                align-items:center !important;
                                justify-content:center !important;
                                width:32px !important;
                                height:32px !important;
                                min-width:32px !important;
                                border:none !important;
                                border-radius:50% !important;
                                background:#e74c3c !important;
                                color:white !important;
                                cursor:pointer !important;
                                padding:0 !important;
                                margin:0 !important;
                                flex:0 0 32px !important;
                            "
                        >
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        pendingSection.style.display = 'none';
        pendingList.innerHTML = '';
    }
}

function renderMemberItem(m) {
    var role = m.role === 'owner' ? 'Chủ kênh' : (m.role === 'admin' ? 'Quản trị' : 'Thành viên');
    var online = m.is_online ? ' online' : '';

    var avatarHtml = m.avatar
        ? `<img src="${m.avatar}" class="member-avatar-img" onerror="this.onerror=null;this.src='';this.nextSibling.style.display='flex';this.style.display='none'" />
           <div class="member-avatar" style="display:none;"><i class="fas fa-user-circle"></i></div>`
        : `<div class="member-avatar"><i class="fas fa-user-circle"></i></div>`;

    var displayName = m.username || m.email || 'User';
    var isMe = normalizeEmail(m.email) === normalizeEmail(getCurrentUserEmail());

    if (isMe) {
        displayName += ' (Bạn)';
    }

    var canKick =
        currentChannel &&
        currentChannel.is_owner &&
        !isMe &&
        m.role !== 'owner' &&
        m.status !== 'pending';

    var kickButtonHtml = '';

    if (canKick) {
        const safeEmailForJs = String(m.email || '').replace(/'/g, "\\'");

        kickButtonHtml = `
            <button
                type="button"
                class="member-kick-btn"
                title="Kick khỏi kênh"
                onclick="event.stopPropagation(); kickMember('${safeEmailForJs}')"
            >
                <i class="fas fa-user-times"></i>
            </button>
        `;
    }

    return `
        <div class="member-item${online}" data-email="${escapeHtml(m.email || '')}" onclick="viewProfile('${encodeURIComponent(m.email || '')}')">
            ${avatarHtml}

            <div class="member-info">
                <span class="member-name">${escapeHtml(displayName)}</span>
                <span class="member-role">${role}</span>
            </div>

            ${kickButtonHtml}
        </div>
    `;
}
function viewProfile(email) { window.open(`http://localhost:5173/profile/${encodeURIComponent(email)}`, '_blank'); }
function approveMember(memberEmail) {
    if (!currentChannel || !currentChannel.is_owner) {
        showToast('Bạn không có quyền phê duyệt thành viên', 'error');
        return;
    }

    apiCall('/channels/' + currentChannel.channel_id + '/approve', 'POST', {
        email: memberEmail,
        approve: true
    })
        .then(() => {
            showToast('Đã chấp nhận yêu cầu tham gia', 'success');
            loadMembers(currentChannel.channel_id);
        })
        .catch(err => {
            showToast('Lỗi chấp nhận yêu cầu: ' + err.message, 'error');
        });
}
function kickMember(memberEmail) {
    if (!currentChannel || !currentChannel.is_owner) {
        showToast('Bạn không có quyền kick thành viên', 'error');
        return;
    }

    if (normalizeEmail(memberEmail) === normalizeEmail(getCurrentUserEmail())) {
        showToast('Bạn không thể tự kick chính mình', 'error');
        return;
    }

    if (!confirm(`Bạn có chắc muốn kick ${memberEmail} khỏi kênh này?`)) {
        return;
    }

    apiCall(
        '/channels/' + currentChannel.channel_id + '/kick/' + encodeURIComponent(memberEmail),
        'POST'
    )
        .then(() => {
            showToast('Đã kick thành viên khỏi kênh', 'success');

            memberList = memberList.filter(m => normalizeEmail(m.email) !== normalizeEmail(memberEmail));
            renderMembers();

            const memberCountEl = document.getElementById('member-count');
            if (memberCountEl) {
                memberCountEl.innerHTML = '<i class="fas fa-users"></i> <span>' + memberList.length + '</span>';
            }

            loadMembers(currentChannel.channel_id);
        })
        .catch(err => {
            showToast('Lỗi kick thành viên: ' + err.message, 'error');
        });
}
function rejectMember(memberEmail) {
    if (!currentChannel || !currentChannel.is_owner) {
        showToast('Bạn không có quyền từ chối thành viên', 'error');
        return;
    }

    if (!confirm(`Bạn có chắc muốn từ chối yêu cầu tham gia của ${memberEmail}?`)) {
        return;
    }

    apiCall('/channels/' + currentChannel.channel_id + '/approve', 'POST', {
        email: memberEmail,
        approve: false
    })
        .then(() => {
            showToast('Đã từ chối yêu cầu tham gia', 'success');

            // Xóa ngay khỏi state để UI biến mất lập tức
            memberList = memberList.filter(m => m.email !== memberEmail);

            renderMembers();

            // Đồng bộ lại từ backend
            loadMembers(currentChannel.channel_id);
        })
        .catch(err => {
            showToast('Lỗi từ chối yêu cầu: ' + err.message, 'error');
        });
}

// File Upload
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
                const errorMsg = extractErrorMessage(errData, 'Upload failed');
                const error = new Error(errorMsg);
                error.status = response.status;
                error.data = errData;
                throw error;
            }
            const data = await response.json();
            let msgType = 'file';
            if (file.type.startsWith('image/')) msgType = 'image';
            else if (file.type.startsWith('video/')) msgType = 'video';
            await apiCall(`/channels/chatrooms/${currentChatroom.room_id}/messages`, 'POST', { content: data.file_id, msg_type: msgType, file_id: data.file_id, file_name: file.name });
            loadMessages();
            showToast('Đã gửi file', 'success');
        } catch (err) {
            console.error('Upload error:', err);
            if (err.status === 503) {
                showUploadErrorByStatus(503, err.message || 'AI kiểm duyệt đang không khả dụng, vui lòng thử lại sau');
            } else if (err.status === 400) {
                showUploadErrorByStatus(400, err.message || 'File không được phép upload do vi phạm quy tắc kiểm duyệt');
            } else {
                showToast('Lỗi upload: ' + (err.message || 'Upload thất bại'), 'error');
            }
        } finally {
            attachBtn.innerHTML = originalHtml;
            attachBtn.disabled = false;
            fileInputChannel.value = '';
        }
    });
}

function handleReturnFromMeeting() {
    const urlParams = new URLSearchParams(window.location.search);
    const channelId = urlParams.get('channel');
    const chatroomId = urlParams.get('chatroom');
    const isReturn = urlParams.has('return');
    if (isReturn && channelId && chatroomId) {
        const url = new URL(window.location);
        url.searchParams.delete('return');
        window.history.replaceState({}, '', url);
        if (currentChannel && currentChannel.channel_id === channelId) {
            if (chatroomList.length > 0) selectChatroom(chatroomId);
            else loadChatrooms(channelId).then(() => selectChatroom(chatroomId));
        } else {
            selectChannel(channelId).then(() => {
                const interval = setInterval(() => { if (chatroomList.length > 0) { clearInterval(interval); selectChatroom(chatroomId); } }, 100);
            });
        }
    }
}

// ====== Moderation Rules ======
let currentModerationSettings = {
    enabled: false,
    rules_text: "",
    enabled_types: [],
    action: "warn",
    max_violations: 3,
    penalty_time: null
};

async function loadChannelRules() {
    if (!currentChannel) return;
    try {
        const data = await apiCall(`/channels/${currentChannel.channel_id}/rules`);
        currentModerationSettings = data;
        document.getElementById('enable-moderation').checked = data.enabled || false;
        document.getElementById('moderation-rules-container').style.display = data.enabled ? 'block' : 'none';
        document.getElementById('moderation-rules-text').value = data.rules_text || '';
        document.getElementById('moderate-text').checked = data.enabled_types?.includes('text') ?? true;
        document.getElementById('moderate-image').checked = data.enabled_types?.includes('image') ?? false;
        document.getElementById('moderate-video').checked = data.enabled_types?.includes('video') ?? false;
        document.getElementById('moderate-file').checked = data.enabled_types?.includes('file') ?? false;
        document.getElementById('moderation-action').value = data.action || 'warn';
        document.getElementById('max-violations').value = data.max_violations || 3;
        document.getElementById('penalty-time').value = data.penalty_time || 10;
        const penaltyGroup = document.getElementById('penalty-time-group');
        if (penaltyGroup) penaltyGroup.style.display = (data.action === 'mute') ? 'block' : 'none';
    } catch (err) {
        console.error('Failed to load moderation settings:', err);
    }
}

function collectModerationSettings() {
    const enabled = document.getElementById('enable-moderation')?.checked || false;
    const rules_text = document.getElementById('moderation-rules-text')?.value.trim() || '';
    const enabled_types = [];
    if (document.getElementById('moderate-text')?.checked) enabled_types.push('text');
    if (document.getElementById('moderate-image')?.checked) enabled_types.push('image');
    if (document.getElementById('moderate-video')?.checked) enabled_types.push('video');
    if (document.getElementById('moderate-file')?.checked) enabled_types.push('file');
    const action = document.getElementById('moderation-action')?.value || 'warn';
    const max_violations = parseInt(document.getElementById('max-violations')?.value) || 3;
    const penalty_time = action === 'mute' ? (parseInt(document.getElementById('penalty-time')?.value) || 10) : null;
    return { enabled, rules_text, enabled_types, action, max_violations, penalty_time };
}

document.getElementById('enable-moderation')?.addEventListener('change', (e) => {
    document.getElementById('moderation-rules-container').style.display = e.target.checked ? 'block' : 'none';
});

document.getElementById('moderation-action')?.addEventListener('change', (e) => {
    const group = document.getElementById('penalty-time-group');
    if (group) group.style.display = e.target.value === 'mute' ? 'block' : 'none';
});

document.getElementById('btn-submit-edit-channel').addEventListener('click', async function () {
    console.log('Save button clicked');
    const name = document.getElementById('input-edit-channel-name')?.value.trim();
    const description = document.getElementById('input-edit-channel-desc')?.value.trim();
    const requireApproval = document.getElementById('input-edit-require-approval')?.checked || false;
    if (!name) { showToast('Vui lòng nhập tên kênh', 'error'); return; }
    const avatar = currentChannel?.avatar || null;

    let modSettings = {};
    try {
        modSettings = collectModerationSettings();
        console.log('Moderation settings:', modSettings);
    } catch (e) {
        console.error('Error collecting moderation settings:', e);
        showToast('Lỗi thu thập cài đặt kiểm duyệt: ' + e.message, 'error');
        return;
    }

    try {
        await apiCall('/channels/' + currentChannel.channel_id, 'PUT', { name, description, require_approval: requireApproval, avatar });
        await apiCall('/channels/' + currentChannel.channel_id + '/rules', 'PUT', modSettings);
        showToast('Cập nhật kênh thành công!', 'success');
        document.getElementById('modal-channel-settings').style.display = 'none';
        selectChannel(currentChannel.channel_id);
        loadChannels();
    } catch (err) {
        showToast('Lỗi cập nhật: ' + err.message, 'error');
    }
});

function buildInviteLink(inviteCode) {
    return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(inviteCode)}`;
}
async function handleInviteLinkJoin() {
    const urlParams = new URLSearchParams(window.location.search);

    const inviteCode = urlParams.get('invite');

    if (!inviteCode) return;

    try {
        const result = await apiCall('/channels/join', 'POST', {
            invite_code: inviteCode
        });

        if (result.status === 'pending') {
            showToast('Đã gửi yêu cầu tham gia kênh, chờ chủ kênh phê duyệt', 'success');
        } else {
            showToast('Tham gia kênh thành công!', 'success');
        }

        urlParams.delete('invite');

        const newQuery = urlParams.toString();
        const newUrl = window.location.pathname + (newQuery ? '?' + newQuery : '');

        window.history.replaceState({}, document.title, newUrl);

        await loadChannels();

        if (result.channel_id && result.status !== 'pending') {
            selectChannel(result.channel_id);
        }

    } catch (err) {
        console.error('Join by invite link error:', err);

        urlParams.delete('invite');

        const newQuery = urlParams.toString();
        const newUrl = window.location.pathname + (newQuery ? '?' + newQuery : '');

        window.history.replaceState({}, document.title, newUrl);

        showToast('Lỗi tham gia kênh qua link mời: ' + err.message, 'error');
    }
}

// ====== Other UI event handlers (create channel, join channel, etc.) ======
document.getElementById('btn-create-channel').addEventListener('click', () => document.getElementById('modal-create-channel').style.display = 'flex');
document.getElementById('btn-submit-create-channel').addEventListener('click', async () => {
    var name = document.getElementById('input-channel-name').value.trim();
    var description = document.getElementById('input-channel-desc').value.trim();
    var requireApproval = document.getElementById('input-require-approval').checked;
    if (!name) { showToast('Vui lòng nhập tên kênh', 'error'); return; }
    const submitBtn = document.getElementById('btn-submit-create-channel');
    const originalText = submitBtn.innerText;
    submitBtn.disabled = true; submitBtn.innerText = 'Đang tạo...';
    try {
        await apiCall('/channels/create', 'POST', { name, description, require_approval });
        showToast('Tạo kênh thành công!', 'success');
        document.getElementById('modal-create-channel').style.display = 'none';
        document.getElementById('input-channel-name').value = '';
        document.getElementById('input-channel-desc').value = '';
        document.getElementById('input-require-approval').checked = false;
        await loadChannels();
    } catch (err) { console.error('Create channel error:', err); showToast('Lỗi tạo kênh: ' + err.message, 'error'); }
    finally { submitBtn.disabled = false; submitBtn.innerText = originalText; }
});
document.getElementById('btn-join-channel').addEventListener('click', () => document.getElementById('modal-join-channel').style.display = 'flex');
document.getElementById('btn-submit-join-channel').addEventListener('click', () => {
    var inviteCode = document.getElementById('input-invite-code').value.trim();
    if (!inviteCode) { showToast('Vui lòng nhập mã mời', 'error'); return; }
    apiCall('/channels/join', 'POST', { invite_code: inviteCode }).then(data => {
        if (data.status === 'pending') showToast('Đã gửi yêu cầu tham gia, chờ phê duyệt', 'success');
        else showToast('Tham gia kênh thành công!', 'success');
        document.getElementById('modal-join-channel').style.display = 'none';
        document.getElementById('input-invite-code').value = '';
        loadChannels();
    }).catch(err => showToast('Lỗi tham gia kênh: ' + err.message, 'error'));
});
document.getElementById('btn-create-chatroom').addEventListener('click', () => document.getElementById('modal-create-chatroom').style.display = 'flex');
document.getElementById('btn-submit-create-chatroom').addEventListener('click', () => {
    var name = document.getElementById('input-chatroom-name').value.trim();
    var description = document.getElementById('input-chatroom-desc').value.trim();
    var type = document.querySelector('input[name="chatroom-type"]:checked').value;
    if (!name) { showToast('Vui lòng nhập tên phòng', 'error'); return; }
    apiCall('/channels/' + currentChannel.channel_id + '/chatrooms', 'POST', { name, description, room_type: type }).then(() => {
        showToast('Tạo phòng chat thành công!', 'success');
        document.getElementById('modal-create-chatroom').style.display = 'none';
        document.getElementById('input-chatroom-name').value = '';
        document.getElementById('input-chatroom-desc').value = '';
        loadChatrooms(currentChannel.channel_id);
    }).catch(err => showToast('Lỗi tạo phòng chat: ' + err.message, 'error'));
});
document.getElementById('btn-channel-settings').addEventListener('click', () => {
    if (!currentChannel) return;
    document.getElementById('input-edit-channel-name').value = currentChannel.name || '';
    document.getElementById('input-edit-channel-desc').value = currentChannel.description || '';
    document.getElementById('input-edit-require-approval').checked = currentChannel.require_approval || false;
    document.getElementById('display-invite-code').textContent = currentChannel.invite_code || '-';
    loadChannelAvatarPreview();
    document.getElementById('modal-channel-settings').style.display = 'flex';
});
document.getElementById('btn-delete-channel').addEventListener('click', () => {
    if (!confirm('Bạn có chắc muốn xóa kênh này?')) return;
    apiCall('/channels/' + currentChannel.channel_id, 'DELETE').then(() => {
        showToast('Đã xóa kênh', 'success');
        document.getElementById('modal-channel-settings').style.display = 'none';
        currentChannel = null; currentChatroom = null;
        document.getElementById('channel-empty').style.display = 'flex';
        document.getElementById('channel-detail').style.display = 'none';
        loadChannels(); stopMemberPolling();
    }).catch(err => showToast('Lỗi xóa kênh: ' + err.message, 'error'));
});
document.getElementById('btn-copy-invite-code').addEventListener('click', () => {
    var code = document.getElementById('display-invite-code').textContent;
    if (code && code !== '-') navigator.clipboard.writeText(code).then(() => showToast('Đã sao chép mã mời!', 'success'));
});
document.getElementById('btn-invite-code').addEventListener('click', () => {
    if (!currentChannel || !currentChannel.invite_code) {
        showToast('Không tìm thấy mã mời của kênh', 'error');
        return;
    }

    const inviteLink = buildInviteLink(currentChannel.invite_code);

    navigator.clipboard.writeText(inviteLink)
        .then(() => {
            showToast('Đã sao chép link mời!', 'success');
        })
        .catch(() => {
            showToast('Không thể sao chép link mời', 'error');
        });
});
document.getElementById('btn-chatroom-settings').addEventListener('click', () => {
    if (!currentChatroom) return;
    document.getElementById('input-edit-chatroom-name').value = currentChatroom.name || '';
    document.getElementById('input-edit-chatroom-desc').value = currentChatroom.description || '';
    document.getElementById('modal-chatroom-settings').style.display = 'flex';
});
document.getElementById('btn-submit-edit-chatroom').addEventListener('click', () => {
    var name = document.getElementById('input-edit-chatroom-name').value.trim();
    var description = document.getElementById('input-edit-chatroom-desc').value.trim();
    if (!name) { showToast('Vui lòng nhập tên phòng', 'error'); return; }
    apiCall('/channels/chatrooms/' + currentChatroom.room_id, 'PUT', { name, description }).then(() => {
        showToast('Cập nhật phòng chat thành công!', 'success');
        document.getElementById('modal-chatroom-settings').style.display = 'none';
        loadChatrooms(currentChannel.channel_id);
        selectChatroom(currentChatroom.room_id);
    }).catch(err => showToast('Lỗi cập nhật phòng chat: ' + err.message, 'error'));
});
document.getElementById('btn-delete-chatroom').addEventListener('click', () => {
    if (!confirm('Bạn có chắc muốn xóa phòng chat này?')) return;
    apiCall('/channels/chatrooms/' + currentChatroom.room_id, 'DELETE').then(() => {
        showToast('Đã xóa phòng chat', 'success');
        document.getElementById('modal-chatroom-settings').style.display = 'none';
        currentChatroom = null;
        document.getElementById('chatroom-empty-inner').style.display = 'flex';
        document.getElementById('chatroom-active').style.display = 'none';
        loadChatrooms(currentChannel.channel_id);
    }).catch(err => showToast('Lỗi xóa phòng chat: ' + err.message, 'error'));
});
document.getElementById('btn-leave-channel').addEventListener('click', function () {
    if (!currentChannel) return;
    if (currentChannel.is_owner) {
        if (!confirm('Bạn là chủ kênh. Bạn có chắc muốn xóa kênh này?')) return;
        apiCall('/channels/' + currentChannel.channel_id, 'DELETE').then(async () => {
            await clearUserSession();
            showToast('Đã xóa kênh', 'success');
            currentChannel = null; currentChatroom = null;
            document.getElementById('channel-empty').style.display = 'flex';
            document.getElementById('channel-detail').style.display = 'none';
            loadChannels(); stopChatroomPolling(); stopMemberPolling();
        }).catch(err => showToast('Lỗi xóa kênh: ' + err.message, 'error'));
    } else {
        if (!confirm('Bạn có chắc muốn rời kênh này?')) return;
        apiCall('/channels/' + currentChannel.channel_id + '/leave', 'POST').then(async () => {
            await clearUserSession();
            showToast('Đã rời kênh', 'success');
            currentChannel = null; currentChatroom = null;
            document.getElementById('channel-empty').style.display = 'flex';
            document.getElementById('channel-detail').style.display = 'none';
            loadChannels(); stopChatroomPolling(); stopMemberPolling();
        }).catch(err => showToast('Lỗi rời kênh: ' + err.message, 'error'));
    }
});

// Send Message
document.getElementById('btn-send-message').addEventListener('click', sendMessage);
document.getElementById('chat-message-input').addEventListener('keypress', function (e) { if (e.key === 'Enter') sendMessage(); });
let cachedFullName = null;
async function getUserFullName() {
    if (cachedFullName) return cachedFullName;
    try {
        const email = getCurrentUserEmail();
        const data = await apiCall(`/account/account_info?email=${email}`);
        cachedFullName = data.fullName || email.split('@')[0];
        return cachedFullName;
    } catch (e) { console.error("Lỗi lấy fullName:", e); const email = getCurrentUserEmail(); cachedFullName = email.split('@')[0]; return cachedFullName; }
}
async function sendMessage() {
    var input = document.getElementById('chat-message-input');
    var content = input.value.trim();
    if (!content || !currentChatroom) return;
    input.value = '';
    const fullName = await getUserFullName();
    const userEmail = getCurrentUserEmail();
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
    messageList.push(tempMsg);
    appendNewMessages([tempMsg]);
    try {
        const realMsg = await apiCall(`/channels/chatrooms/${currentChatroom.room_id}/messages`, 'POST', { content: content });
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
        const index = messageList.findIndex(m => m.message_id === tempId);
        if (index !== -1) {
            messageList.splice(index, 1);
            const msgDiv = document.querySelector(`.message-item[data-temp-id="${tempId}"]`);
            if (msgDiv) msgDiv.remove();
        }
        showToast('Lỗi gửi tin nhắn: ' + err.message, 'error');
        input.value = content;
    }
}

function updateMediaButtonsVisibility() {
    const isVoice = currentChatroom && currentChatroom.room_type === 'voice';
    const mediaGalleryBtn = document.getElementById('btn-media-gallery');
    const filesListBtn = document.getElementById('btn-files-list');
    const searchBtn = document.getElementById('btn-search-messages');
    if (mediaGalleryBtn) mediaGalleryBtn.style.display = isVoice ? 'none' : 'inline-flex';
    if (filesListBtn) filesListBtn.style.display = isVoice ? 'none' : 'inline-flex';
    if (searchBtn) searchBtn.style.display = isVoice ? 'none' : 'inline-flex';
}

// Media gallery, files, search listeners
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
        if (media.length === 0) { contentDiv.innerHTML = '<p>Không có ảnh hoặc video nào.</p>'; return; }
        let html = '<div class="media-grid">';
        for (let item of media) {
            const fileUrl = await getFileUrl(item.file_id);
            if (item.type === 'image') html += `<div class="media-item"><img src="${fileUrl}" onclick="window.open('${fileUrl}')"></div>`;
            else if (item.type === 'video') html += `<div class="media-item"><video src="${fileUrl}" controls style="max-width:100%"></video></div>`;
        }
        html += '</div>';
        contentDiv.innerHTML = html;
    } catch (err) { contentDiv.innerHTML = `<p>Lỗi: ${err.message}</p>`; }
});
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
        if (files.length === 0) { contentDiv.innerHTML = '<p>Không có tài liệu nào.</p>'; return; }
        let html = '<ul class="file-list">';
        for (let item of files) {
            const fileUrl = await getFileUrl(item.file_id);
            html += `<li><i class="fas fa-file"></i> <a href="${fileUrl}" target="_blank">${escapeHtml(item.file_name)}</a> - ${escapeHtml(item.sender_name)} (${formatDate(item.created_at)})</li>`;
        }
        html += '</ul>';
        contentDiv.innerHTML = html;
    } catch (err) { contentDiv.innerHTML = `<p>Lỗi: ${err.message}</p>`; }
});
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
        if (results.length === 0) { resultsDiv.innerHTML = '<p>Không tìm thấy tin nhắn nào.</p>'; return; }
        let html = '<div class="search-results-list">';
        for (let msg of results) {
            const fileUrl = (msg.msg_type !== 'text' && msg.content) ? await getFileUrl(msg.content) : null;
            let contentHtml = '';
            if (msg.msg_type === 'image' && fileUrl) contentHtml = `<img src="${fileUrl}" style="max-width:100px">`;
            else if (msg.msg_type === 'video' && fileUrl) contentHtml = `<video src="${fileUrl}" controls style="max-width:150px"></video>`;
            else if (msg.msg_type === 'file' && fileUrl) contentHtml = `<a href="${fileUrl}" target="_blank">${escapeHtml(msg.file_name)}</a>`;
            else contentHtml = escapeHtml(msg.content);
            html += `<div class="search-result-item"><div class="search-result-sender">${escapeHtml(msg.sender_name || msg.sender_email)}</div><div class="search-result-content">${contentHtml}</div><div class="search-result-time">${formatTime(msg.created_at)}</div></div>`;
        }
        html += '</div>';
        resultsDiv.innerHTML = html;
    } catch (err) { resultsDiv.innerHTML = `<p>Lỗi: ${err.message}</p>`; }
});

document.getElementById('btn-start-meeting').addEventListener('click', function () {
    if (!currentChatroom) return;
    apiCall('/channels/chatrooms/' + currentChatroom.room_id + '/start-meeting', 'POST').then(data => { location.href = '/room.html?room=' + data.room_id; }).catch(err => showToast('Lỗi tạo phòng họp: ' + err.message, 'error'));
});
document.getElementById('search-channel').addEventListener('input', renderChannelList);
document.querySelectorAll('.modal-close').forEach(btn => { btn.addEventListener('click', function () { var modalId = btn.getAttribute('data-modal'); document.getElementById(modalId).style.display = 'none'; }); });
document.querySelectorAll('.modal-overlay').forEach(overlay => { overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.style.display = 'none'; }); });

function goBack() { window.history.back(); }

let returningFromMeeting = false;
function handleUrlSelection() {
    const urlParams = new URLSearchParams(window.location.search);
    const channelId = urlParams.get('channel');
    const chatroomId = urlParams.get('chatroom');
    returningFromMeeting = urlParams.has('return');
    if (channelId && chatroomId) {
        const checkInterval = setInterval(() => {
            if (channelList.length > 0) {
                clearInterval(checkInterval);
                const channelExists = channelList.some(ch => ch.channel_id === channelId);
                if (!channelExists) {
                    const url = new URL(window.location);
                    url.searchParams.delete('channel'); url.searchParams.delete('chatroom'); url.searchParams.delete('return');
                    window.history.replaceState({}, '', url);
                    return;
                }
                selectChannel(channelId).then(() => {
                    setTimeout(() => {
                        if (chatroomList.length > 0) selectChatroom(chatroomId);
                        else loadChatrooms(channelId).then(() => selectChatroom(chatroomId));
                    }, 500);
                });
            }
        }, 100);
    }
}

loadChannels();
setTimeout(() => {
    handleInviteLinkJoin();
}, 300);
setTimeout(handleUrlSelection, 500);