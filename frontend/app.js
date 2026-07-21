const feedEl = document.getElementById('feed');
const feedEmptyEl = document.getElementById('feedEmpty');
const textEl = document.getElementById('postText');
const imageInput = document.getElementById('postImage');
const fileLabel = document.getElementById('fileLabel');
const previewWrap = document.getElementById('imagePreviewWrap');
const previewImg = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');
const submitBtn = document.getElementById('submitBtn');
const errorEl = document.getElementById('composerError');
const loadMoreWrap = document.getElementById('loadMoreWrap');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const toastEl = document.getElementById('toast');

let selectedFile = null;
let oldestLoaded = null;
let reportedIds = new Set(JSON.parse(localStorage.getItem('tma_reported') || '[]'));

function saveReported() {
  localStorage.setItem('tma_reported', JSON.stringify([...reportedIds]));
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderPost(post) {
  const card = document.createElement('article');
  card.className = 'post-card';
  card.dataset.id = post.id;

  let html = '';
  if (post.text) {
    html += `<p class="post-text">${escapeHtml(post.text)}</p>`;
  }
  if (post.imageUrl) {
    html += `<img class="post-image" src="${API_BASE_URL}${post.imageUrl}" alt="attached image" loading="lazy" />`;
  }

  const alreadyReported = reportedIds.has(post.id);
  html += `
    <div class="post-meta">
      <span>${timeAgo(post.createdAt)}</span>
      <button class="report-btn" data-id="${post.id}" ${alreadyReported ? 'disabled' : ''}>
        ${alreadyReported ? 'reported' : 'report'}
      </button>
    </div>
  `;

  card.innerHTML = html;
  return card;
}

async function loadPosts({ before, append } = {}) {
  try {
    const url = new URL(`${API_BASE_URL}/api/posts`);
    url.searchParams.set('limit', '20');
    if (before) url.searchParams.set('before', before);

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load posts');
    const posts = await res.json();

    if (!append) feedEl.querySelectorAll('.post-card').forEach((el) => el.remove());

    if (posts.length === 0 && !append) {
      feedEmptyEl.hidden = false;
      loadMoreWrap.hidden = true;
      return;
    }
    feedEmptyEl.hidden = true;

    posts.forEach((p) => feedEl.appendChild(renderPost(p)));

    if (posts.length > 0) {
      oldestLoaded = posts[posts.length - 1].createdAt;
    }
    loadMoreWrap.hidden = posts.length < 20;
  } catch (err) {
    console.error(err);
    showToast('couldn\'t reach the server. is the backend running?');
  }
}

loadMoreBtn.addEventListener('click', () => {
  if (oldestLoaded) loadPosts({ before: oldestLoaded, append: true });
});

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) return;
  selectedFile = file;
  fileLabel.textContent = file.name.length > 22 ? file.name.slice(0, 19) + '...' : file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewWrap.hidden = false;
  };
  reader.readAsDataURL(file);
});

removeImageBtn.addEventListener('click', () => {
  selectedFile = null;
  imageInput.value = '';
  fileLabel.textContent = '+ attach photo';
  previewWrap.hidden = true;
});

async function submitPost() {
  const text = textEl.value.trim();
  errorEl.hidden = true;

  if (!text && !selectedFile) {
    errorEl.textContent = 'add some text or a photo first.';
    errorEl.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'DROPPING...';

  try {
    const formData = new FormData();
    if (text) formData.append('text', text);
    if (selectedFile) formData.append('image', selectedFile);

    const res = await fetch(`${API_BASE_URL}/api/posts`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'something went wrong.';
      errorEl.hidden = false;
      return;
    }

    textEl.value = '';
    selectedFile = null;
    imageInput.value = '';
    fileLabel.textContent = '+ attach photo';
    previewWrap.hidden = true;

    feedEmptyEl.hidden = true;
    feedEl.prepend(renderPost(data));
    showToast('leaked.');
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'couldn\'t reach the server.';
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'DROP IT';
  }
}

submitBtn.addEventListener('click', submitPost);
textEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitPost();
});

feedEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.report-btn');
  if (!btn) return;
  const id = btn.dataset.id;
  if (reportedIds.has(id)) return;

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch(`${API_BASE_URL}/api/posts/${id}/report`, { method: 'POST' });
    const data = await res.json();
    reportedIds.add(id);
    saveReported();
    btn.textContent = 'reported';
    showToast(data.hidden ? 'post pulled after reports.' : 'reported.');
    if (data.hidden) {
      const card = btn.closest('.post-card');
      if (card) card.remove();
    }
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'report';
    showToast('report failed, try again.');
  }
});

loadPosts();
