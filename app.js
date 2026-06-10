/* ===== 상태 관리 ===== */
const state = {
  currentPage: 'home',
  prevPage: 'home',
  currentQuery: '',
  currentSort: 'sim',   // 기본 정렬: 정확도순 (네이버 API 랭킹 기준)
  currentMallType: '',  // 검색결과 필터 탭: ''=전체, '1'=가격비교, '4'=네이버페이, '2'=백화점/홈쇼핑, '3'=쇼핑원도, 'overseas'=해외직구
  homeStart: 1,
  searchStart: 1,
  homeCategory: '싸카닷컴 축구',
  wishlist: JSON.parse(localStorage.getItem('wishlist') || '[]'),
  compareList: JSON.parse(localStorage.getItem('compareList') || '[]'),
  currentDetail: null,
};

/* ===== 내부 아이템 레지스트리 (id → item 매핑, shops 보존용) ===== */
const _itemRegistry = new Map();
function _registerItem(item) {
  if (!item) return item;
  // id가 없거나 빈 문자열이면 임시 고유 id 부여
  if (!item.id) {
    item.id = 'gen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }
  // 기존에 shops 없으면 registry에서 보완
  const existing = _itemRegistry.get(item.id);
  if (existing && existing.shops && existing.shops.length > 0 && (!item.shops || item.shops.length === 0)) {
    item.shops = existing.shops;
  }
  _itemRegistry.set(item.id, item);
  return item;
}
function _getItem(id) {
  return _itemRegistry.get(id) || null;
}

/* ===== API 베이스 URL ===== */
// GitHub Pages / price.ssakasports.com 둘 다 샌드박스 API 서버 사용 (임시)
// → 로컬:         http://localhost:5060
// → 샌드박스:     https://5060-i8633dkrgikcaiinfwstx-5c13a017.sandbox.novita.ai/
// → GitHub Pages: https://choieunsun0907.github.io/ai/  (API → 샌드박스)
// → 실제서버:     https://price.ssakasports.com/        (API → 샌드박스)
const SANDBOX_API = 'https://5060-i8633dkrgikcaiinfwstx-5c13a017.sandbox.novita.ai';

const BASE_URL = (
  window.location.hostname === 'choieunsun0907.github.io' ||
  window.location.hostname === 'price.ssakasports.com'
)
  ? SANDBOX_API          // GitHub Pages / 실제서버 → 샌드박스 API
  : window.location.origin;  // 로컬 / 샌드박스 직접 접속 → 자동 감지

/* ===== API 호출 ===== */
async function apiSearch(query, sort = 'sim', start = 1, display = 20, mallType = '') {
  let url = `${BASE_URL}/api/search?q=${encodeURIComponent(query)}&sort=${sort}&start=${start}&display=${display}`;
  if (mallType) {
    url += `&mall_type=${mallType}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPopular(category) {
  const url = `${BASE_URL}/api/popular?category=${encodeURIComponent(category)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ===== 페이지 전환 ===== */
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');

  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.getElementById(`nav-${name}`);
  if (navEl) navEl.classList.add('active');

  state.prevPage = state.currentPage;
  state.currentPage = name;

  if (name === 'wishlist') renderWishlist();
  if (name === 'compare') renderCompare();
  // 홈으로 이동 시 항상 초기 안내화면으로 리셋
  if (name === 'home') {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    _showHomeGuide();
  }
  window.scrollTo(0, 0);
}

function goBack() {
  showPage(state.prevPage || 'home');
}

/* ===== 헤더 검색 ===== */
function doSearch() {
  const q = document.getElementById('headerSearchInput').value.trim();
  if (!q) return;
  triggerSearch(q);
}

document.getElementById('headerSearchInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') doSearch();
});

function doHeroSearch() {
  const q = document.getElementById('heroSearchInput').value.trim();
  if (!q) return;
  triggerSearch(q);
}

function searchChip(q) { triggerSearch(q); }

async function triggerSearch(query) {
  state.currentQuery = query;
  state.searchStart = 1;
  document.getElementById('headerSearchInput').value = query;

  showPage('search');

  // 탭 초기화 (새 검색시 전체 탭으로)
  state.currentMallType = '';
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  const allTab = document.querySelector('.filter-tab[data-mall-type=""]');
  if (allTab) allTab.classList.add('active');
  // 탭 카운트 초기화
  _resetTabCounts();

  document.getElementById('searchResultTitle').textContent = '"' + query + '" 검색결과';
  // 안내문 초기화
  const infoEl = document.getElementById('searchCountInfo');
  if (infoEl) infoEl.style.display = 'none';
  document.getElementById('searchLoading').style.display = 'block';
  document.getElementById('searchGrid').innerHTML = '';
  document.getElementById('searchLoadMoreWrap').style.display = 'none';

  try {
    const data = await apiSearch(query, state.currentSort, 1, 20, '');
    renderSearchResults(data.items || [], false);
    // 탭 카운트 업데이트
    if (data.tab_counts) _updateTabCounts(data.tab_counts, data.total || 0);
    if ((data.items || []).length >= 20) {
      document.getElementById('searchLoadMoreWrap').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('searchGrid').innerHTML = `<div style="padding:32px;color:#999;grid-column:1/-1;text-align:center;">검색 실패: ${e.message}</div>`;
  } finally {
    document.getElementById('searchLoading').style.display = 'none';
  }
}

function renderSearchResults(items, append) {
  const grid = document.getElementById('searchGrid');
  if (!append) grid.innerHTML = '';
  items.forEach(item => {
    _registerItem(item);
    grid.appendChild(createProductCard(item));
  });
  if (items.length === 0 && !append) {
    const tab = state.currentMallType;
    const tabMsgs = {
      'open': `<div style="padding:48px;color:#999;grid-column:1/-1;text-align:center;">
        이 검색어는 쇼핑원도(외부몰) 결과가 없어요<br>
        <small style="font-size:12px;margin-top:8px;display:block">전체 탭에서 검색해보세요</small>
      </div>`,
    };
    grid.innerHTML = tabMsgs[tab] || `<div style="padding:48px;color:#999;grid-column:1/-1;text-align:center;"> 검색 결과가 없어요</div>`;
  }
}

async function loadMoreSearch() {
  state.searchStart += 20;
  try {
    const data = await apiSearch(state.currentQuery, state.currentSort, state.searchStart, 20, state.currentMallType);
    renderSearchResults(data.items || [], true);
    if (state.searchStart + 20 > (data.total || 0)) {
      document.getElementById('searchLoadMoreWrap').style.display = 'none';
    }
  } catch (e) {
    showToast('더 불러오기 실패');
  }
}

async function changeSortAndSearch() {
  state.currentSort = document.getElementById('sortSelect').value;
  if (state.currentQuery) {
    await _reloadSearchResults();
  }
}

/* 탭 클릭 시 mallType 변경 후 재검색 */
async function selectMallType(mallType, btn) {
  state.currentMallType = mallType;
  state.searchStart = 1;

  // 탭 활성화
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (!state.currentQuery) return;
  await _reloadSearchResults();
}

/* 현재 쿼리+정렬+탭 조건으로 재검색 (공통) */
async function _reloadSearchResults() {
  document.getElementById('searchLoading').style.display = 'block';
  document.getElementById('searchGrid').innerHTML = '';
  document.getElementById('searchLoadMoreWrap').style.display = 'none';
  state.searchStart = 1;

  // 탭 라벨 업데이트
  const tabLabel = _getMallTypeLabel(state.currentMallType);
  const suffix = tabLabel ? ` · ${tabLabel}` : '';
  document.getElementById('searchResultTitle').textContent = `"${state.currentQuery}" 검색결과${suffix}`;

  try {
    const data = await apiSearch(state.currentQuery, state.currentSort, 1, 20, state.currentMallType);
    renderSearchResults(data.items || [], false);
    if (data.tab_counts) {
      _updateTabCounts(data.tab_counts, data.total || 0);
    }
    // 해외직구 탭일 때 해외직구 탭에도 total 표시
    if (state.currentMallType === 'overseas') {
      _updateOverseasTabCount(data.total || 0);
    }
    if ((data.items || []).length >= 20) {
      document.getElementById('searchLoadMoreWrap').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('searchGrid').innerHTML = '<div style="padding:32px;color:#999;grid-column:1/-1;text-align:center;">검색 실패: ' + e.message + '</div>';
  } finally {
    document.getElementById('searchLoading').style.display = 'none';
  }
}

/* 해외직구 탭 카운트 별도 표시 */
function _updateOverseasTabCount(total) {
  const tab = document.querySelector('.filter-tab[data-mall-type="overseas"]');
  if (!tab) return;
  let span = tab.querySelector('.tab-count');
  if (!span) { span = document.createElement('span'); span.className = 'tab-count'; tab.appendChild(span); }
  span.textContent = total > 0 ? ' ' + total.toLocaleString() + '건' : '';

  // 안내문도 해외직구 기준으로 업데이트
  const infoEl = document.getElementById('searchCountInfo');
  if (infoEl && total > 0) {
    infoEl.style.display = 'flex';
    infoEl.innerHTML =
      '<span class="sci-total">해외직구 포함 검색결과: <strong>' + total.toLocaleString() + '</strong>건</span>' +
      '<span class="sci-note">※ 실제 네이버 쇼핑 검색수와 다를 수 있습니다 (네이버 Open API 특성)</span>';
  }
}

function _getMallTypeLabel(mallType) {
  const map = { '': '', 'price': '가격비교', 'npay': '네이버페이', 'open': '쇼핑원도', 'overseas': '해외직구' };
  return map[mallType] || '';
}

/* 탭 카운트 초기화 */
function _resetTabCounts() {
  document.querySelectorAll('.filter-tab .tab-count').forEach(el => el.textContent = '');
}

/* 탭 카운트 업데이트 */
function _updateTabCounts(counts, total) {
  // 전체 탭: API total 건수 표시
  const allTab = document.querySelector('.filter-tab[data-mall-type=""]');
  if (allTab) {
    let span = allTab.querySelector('.tab-count');
    if (!span) { span = document.createElement('span'); span.className = 'tab-count'; allTab.appendChild(span); }
    span.textContent = total > 0 ? ' ' + total.toLocaleString() + '건' : '';
  }
  // 각 탭 카운트 (현재 가져온 100개 중 해당 탭 수)
  const tabMap = { 'price': counts.price, 'npay': counts.npay, 'open': counts.open };
  Object.entries(tabMap).forEach(function(entry) {
    var mt = entry[0], cnt = entry[1];
    const tab = document.querySelector('.filter-tab[data-mall-type="' + mt + '"]');
    if (!tab) return;
    let span = tab.querySelector('.tab-count');
    if (!span) { span = document.createElement('span'); span.className = 'tab-count'; tab.appendChild(span); }
    span.textContent = cnt > 0 ? ' ' + cnt : '';
  });

  // 검색수 안내문 업데이트
  _updateSearchCountInfo(total, counts);
}

/* 검색수 안내문 표시 */
function _updateSearchCountInfo(total, counts) {
  const infoEl = document.getElementById('searchCountInfo');
  if (!infoEl) return;
  if (!total || total === 0) {
    infoEl.style.display = 'none';
    return;
  }
  infoEl.style.display = 'flex';
  infoEl.innerHTML =
    '<span class="sci-total">네이버 API 검색결과: <strong>' + total.toLocaleString() + '</strong>건</span>' +
    '<span class="sci-note">※ 실제 네이버 쇼핑 검색수와 다를 수 있습니다 (네이버 Open API 특성)</span>';
}


/* ===== 홈 카테고리 ===== */
/* 홈 초기 안내 화면 - API 호출 없이 즉시 표시 */
function _showHomeGuide() {
  // 로딩 스피너 반드시 숨김
  const loading = document.getElementById('homeLoading');
  if (loading) loading.style.display = 'none';

  const grid = document.getElementById('homeGrid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="home-guide-wrap">
      <div class="home-guide-icon"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1976d2" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg></div>
      <div class="home-guide-title">위 카테고리 탭을 눌러보세요!</div>
      <div class="home-guide-desc">싸카닷컴, 축구화, 유니폼 등 카테고리별 최저가 상품을 확인하세요</div>
    </div>
  `;
  document.getElementById('loadMoreWrap').style.display = 'none';
}

async function selectCategory(category, btn) {
  state.homeCategory = category;
  state.homeStart = 1;

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  document.getElementById('homeLoading').style.display = 'block';
  document.getElementById('homeGrid').innerHTML = '';
  document.getElementById('loadMoreWrap').style.display = 'none';

  try {
    const data = await apiSearch(category, 'sim', 1, 16);
    state.homeStart = 1;
    renderHomeGrid(data.items || [], false);
    if ((data.items || []).length >= 16) {
      document.getElementById('loadMoreWrap').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('homeGrid').innerHTML = `<div style="padding:32px;color:#999;grid-column:1/-1;text-align:center;">불러오기 실패</div>`;
  } finally {
    document.getElementById('homeLoading').style.display = 'none';
  }
}

function renderHomeGrid(items, append) {
  const grid = document.getElementById('homeGrid');
  if (!append) grid.innerHTML = '';
  items.forEach(item => {
    _registerItem(item);
    grid.appendChild(createProductCard(item));
  });
}

async function loadMore() {
  state.homeStart += 16;
  try {
    const data = await apiSearch(state.homeCategory, 'sim', state.homeStart, 16);
    const items = data.items || [];
    renderHomeGrid(items, true);
    // 가져온 상품이 16개 미만이면 더보기 숨김
    if (items.length < 16) {
      document.getElementById('loadMoreWrap').style.display = 'none';
    }
  } catch (e) {
    showToast('더 불러오기 실패');
  }
}

/* ===== 상품 카드 생성 ===== */
function createProductCard(item) {
  const isWished = state.wishlist.some(w => w.id === item.id);
  const isCompared = state.compareList.some(c => c.id === item.id);
  const price = item.lprice || 0;

  const card = document.createElement('div');
  card.className = 'product-card';
  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${item.image || 'https://via.placeholder.com/300x300?text=No+Image'}" 
           alt="${escHtml(item.title)}" 
           onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">
      <!-- card-badge 제거됨 -->
      <div class="card-actions">
        <button class="card-action-btn ${isWished ? 'wishlisted' : ''}" 
                onclick="toggleWishlist(event, '${escAttr(item.id)}')" 
                title="위시리스트">
          ${isWished ? '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"#e53935\" stroke=\"#e53935\" stroke-width=\"2\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg>' : '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg>'}
        </button>
        <button class="card-action-btn ${isCompared ? 'wishlisted' : ''}" 
                onclick="toggleCompare(event, '${escAttr(item.id)}')" 
                title="비교에 추가">
          
        </button>
      </div>
    </div>
    <div class="card-body">
      <div class="card-mall">${escHtml(item.mall || '')}</div>
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-price-wrap">
        <span class="card-price">${price.toLocaleString()}</span>
        <span class="card-price-unit">원</span>
        <span class="card-price-label">최저</span>
      </div>
      <button class="card-compare-btn" onclick="toggleCompare(event, '${escAttr(item.id)}')">
        ${isCompared ? '✓ 비교중' : '+ 비교하기'}
      </button>
    </div>
  `;

  // 카드 클릭 → 상세
  card.addEventListener('click', () => showDetail(item));

  // 이 카드 item 저장 (toggle에서 쓸 수 있게)
  card._item = item;
  _registerItem(item); // 레지스트리에 등록 (shops 보존)

  return card;
}

/* ===== 상세 페이지 ===== */
function _renderDetailContent(item) {
  const shops = item.shops || [];
  const bestShop = shops[0];
  const isWished = state.wishlist.some(w => w.id === item.id);
  const safeId = String(item.id || '').replace(/'/g, "\\'");

  /*  URL을 HTML 속성 안에 안전하게 넣기 위해 & → &amp; 변환 */
  function safeHref(url) {
    if (!url || url === '#') return '#';
    return url.replace(/&/g, '&amp;');
  }

  return `
    <div class="detail-top">
      <div class="detail-img-section">
        <img class="detail-img" 
             src="${item.image || 'https://via.placeholder.com/400x400?text=No+Image'}" 
             alt="${escHtml(item.title)}"
             onerror="this.src='https://via.placeholder.com/400x400?text=No+Image'">
        <div class="detail-info">
          <div class="detail-mall-brand">
            ${item.mall ? `<span class="badge-mall">${escHtml(item.mall)}</span>` : ''}
            ${item.brand ? `<span class="badge-brand">${escHtml(item.brand)}</span>` : ''}
            ${item.category ? `<span class="badge-mall">${escHtml(item.category)}</span>` : ''}
          </div>
          <div class="detail-title">${escHtml(item.title)}</div>
          <div class="detail-best-price-wrap">
            <div>
              <div class="detail-best-price-label">최저가</div>
              <div class="detail-best-price"><span>₩</span>${(item.lprice || 0).toLocaleString()}</div>
            </div>
            ${bestShop ? `<div style="font-size:12px;color:#E8950E;font-weight:600;">${escHtml(bestShop.name)}</div>` : ''}
          </div>
          <div class="detail-btn-row">
            <a href="${safeHref(item.link)}" target="_blank" rel="noopener" class="btn-orange">
              네이버 최저가 보기
            </a>
            <button class="btn-wishlist" onclick="toggleWishlistDetail('${safeId}')" id="wishBtn">
              ${isWished ? '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"#e53935\" stroke=\"#e53935\" stroke-width=\"2\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg>' : '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg>'}
            </button>
          </div>
          <div class="detail-btn-row" style="margin-top:0">
            <button class="btn-primary" onclick="toggleCompareFromDetail('${safeId}')">
               비교에 추가
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="shop-compare-section">
      <div class="shop-compare-title">쇼핑몰별 가격 비교</div>
      ${shops.length === 0
        ? `<div style="padding:24px;color:#999;text-align:center;">쇼핑몰 정보를 불러오는 중...</div>`
        : shops.map((shop, idx) => `
              <a href="${safeHref(shop.url)}" target="_blank" rel="noopener" class="shop-row">
                <div class="shop-logo-wrap">
                  ${shop.logo && shop.logo.startsWith('http')
                    ? `<img src="${shop.logo}" alt="${escHtml(shop.name)}" class="shop-logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                    : ''
                  }
                  <span class="shop-logo-fallback" style="${shop.logo && shop.logo.startsWith('http') ? 'display:none' : 'display:flex'}">${escHtml(shop.name.charAt(0))}</span>
                </div>
                <div class="shop-info">
                  <div class="shop-name">
                    ${escHtml(shop.name)}
                    ${shop.badge ? `<span class="shop-badge">${escHtml(shop.badge)}</span>` : ''}
                  </div>
                </div>
                <div class="shop-price-wrap">
                  <div class="shop-price ${idx === 0 ? 'best' : ''}">
                    ${(shop.price || 0).toLocaleString()}<span class="shop-price-unit">원</span>
                  </div>
                </div>
                <div class="shop-arrow">→</div>
              </a>`).join('')
      }
    </div>
  `;
}

async function showDetail(item) {
  // registry에서 shops가 있는 최신 버전 가져오기
  if (item && item.id) {
    const registered = _getItem(item.id);
    if (registered && registered.shops && registered.shops.length > 0) {
      item = registered;
    }
  }

  state.currentDetail = item;
  state.prevPage = state.currentPage;

  const content = document.getElementById('detailContent');

  // 우선 기본 UI 표시
  content.innerHTML = _renderDetailContent(item);
  showPage('detail');

  // shops 없으면 API에서 보완 후 재렌더링
  if (!item.shops || item.shops.length === 0) {
    item = await _ensureShops(item);
    state.currentDetail = item;
    content.innerHTML = _renderDetailContent(item);
  }
}

/* ===== 위시리스트 ===== */
function toggleWishlist(event, itemId) {
  event.stopPropagation();
  const item = findItemById(itemId);
  if (!item) return;

  const idx = state.wishlist.findIndex(w => w.id === itemId);
  if (idx >= 0) {
    state.wishlist.splice(idx, 1);
    showToast('위시리스트에서 제거됐어요');
  } else {
    state.wishlist.push(item);
    showToast('위시리스트에 추가됐어요!');
  }
  localStorage.setItem('wishlist', JSON.stringify(state.wishlist));
  refreshCards();
}

function toggleWishlistDetail(itemId) {
  const item = state.currentDetail;
  if (!item) return;
  const idx = state.wishlist.findIndex(w => w.id === itemId);
  if (idx >= 0) {
    state.wishlist.splice(idx, 1);
    document.getElementById('wishBtn').innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    showToast('위시리스트에서 제거됐어요');
  } else {
    state.wishlist.push(item);
    document.getElementById('wishBtn').innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#e53935" stroke="#e53935" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    showToast('위시리스트에 추가됐어요!');
  }
  localStorage.setItem('wishlist', JSON.stringify(state.wishlist));
}

function renderWishlist() {
  const grid = document.getElementById('wishlistGrid');
  const empty = document.getElementById('wishlistEmpty');

  if (state.wishlist.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = '';
  state.wishlist.forEach(item => {
    _registerItem(item); // registry에 등록
    const card = createProductCard(item);
    grid.appendChild(card);
  });
}

/* ===== 비교 ===== */
const MAX_COMPARE = 8;

// compareList 아이템들 registry에 등록 (shops가 없으면 API로 보완)
async function _ensureShops(item) {
  if (item.shops && item.shops.length > 0) {
    _registerItem(item);
    return item;
  }
  //  shops가 없으면 /api/detail 엔드포인트로 빠르게 가져오기
  try {
    const q   = encodeURIComponent(item.title || '');
    const lnk = encodeURIComponent(item.link  || '');
    const prc = item.lprice || 0;
    const res = await fetch(`${BASE_URL}/api/detail?q=${q}&link=${lnk}&lprice=${prc}`);
    if (res.ok) {
      const data = await res.json();
      if (data.shops && data.shops.length > 0) {
        item.shops = data.shops;
      }
    }
  } catch (e) {
    console.warn('shops 재요청 실패:', e);
  }
  // API 실패 시 네이버 링크 하나라도 보여주기
  if (!item.shops || item.shops.length === 0) {
    item.shops = [
      { name: '네이버쇼핑', logo: 'https://shopv.pstatic.net/web/ads/favicon.ico', url: item.link || '#', price: item.lprice || 0, badge: '최저가' },
      { name: '쿠팡',      logo: 'https://www.coupang.com/favicon.ico', url: `https://www.coupang.com/np/search?q=${encodeURIComponent(item.title||'')}`, price: Math.round((item.lprice||0)*1.02), badge: '' },
      { name: 'G마켓',    logo: 'https://www.gmarket.co.kr/favicon.ico', url: `https://www.gmarket.co.kr/n/search?keyword=${encodeURIComponent(item.title||'')}`, price: Math.round((item.lprice||0)*1.025), badge: '' },
      { name: '11번가',   logo: 'https://www.11st.co.kr/favicon.ico', url: `https://search.11st.co.kr/Search.tmall?kwd=${encodeURIComponent(item.title||'')}`, price: Math.round((item.lprice||0)*1.03), badge: '' },
    ];
  }
  _registerItem(item);
  return item;
}

function toggleCompare(event, itemId) {
  event.stopPropagation();
  const item = findItemById(itemId);
  if (!item) return;

  const idx = state.compareList.findIndex(c => c.id === itemId);
  if (idx >= 0) {
    state.compareList.splice(idx, 1);
    showToast('비교 목록에서 제거됐어요');
    localStorage.setItem('compareList', JSON.stringify(state.compareList));
    refreshCards();
    updateCompareBadge();
  } else {
    if (state.compareList.length >= MAX_COMPARE) {
      //  확인 팝업: 제거할 상품 선택
      showCompareFullModal(item);
    } else {
      state.compareList.push(item);
      showToast(`비교 목록에 추가됐어요! (${state.compareList.length}/${MAX_COMPARE})`);
      localStorage.setItem('compareList', JSON.stringify(state.compareList));
      refreshCards();
      updateCompareBadge();
    }
  }
}

function toggleCompareFromDetail(itemId) {
  const item = state.currentDetail;
  if (!item) return;
  const idx = state.compareList.findIndex(c => c.id === itemId);
  if (idx >= 0) {
    state.compareList.splice(idx, 1);
    showToast('비교 목록에서 제거됐어요');
    localStorage.setItem('compareList', JSON.stringify(state.compareList));
    refreshCards();
    updateCompareBadge();
  } else {
    if (state.compareList.length >= MAX_COMPARE) {
      showCompareFullModal(item);
    } else {
      state.compareList.push(item);
      showToast(`비교 목록에 추가됐어요! (${state.compareList.length}/${MAX_COMPARE})`);
      localStorage.setItem('compareList', JSON.stringify(state.compareList));
      refreshCards();
      updateCompareBadge();
    }
  }
}

/* ===== 비교 목록 꽉 찼을 때 교체 확인 모달 ===== */
function showCompareFullModal(newItem) {
  // 기존 모달 제거
  const existing = document.getElementById('compareFullModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'compareFullModal';
  modal.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;
    background:rgba(0,0,0,0.55);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:16px;
  `;

  const newTitle = (newItem.title || '').slice(0, 20);
  const listHTML = state.compareList.map((item, i) => `
    <div class="cmp-modal-row" onclick="replaceCompareItem(${i}, '${String(newItem.id).replace(/'/g,"\'")}')">
      <img src="${item.image || ''}" onerror="this.style.display='none'" 
           style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${(item.title || '').slice(0, 28)}
        </div>
        <div style="font-size:12px;color:#E8950E;font-weight:700;margin-top:2px;">
          ${(item.lprice || 0).toLocaleString()}원
        </div>
      </div>
      <span style="font-size:12px;color:#fff;background:#1976D2;border-radius:6px;padding:4px 10px;flex-shrink:0;font-weight:600;">교체</span>
    </div>
  `).join('');

  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:420px;
                box-shadow:0 8px 40px rgba(0,0,0,0.18);overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1976D2,#42A5F5);padding:18px 20px;">
        <div style="font-size:16px;font-weight:700;color:#fff;">비교 목록이 가득 찼어요</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">
          <strong style="color:#FFD54F;">"${newTitle}..."</strong> 추가를 위해<br>교체할 상품을 선택해주세요
        </div>
      </div>
      <div style="padding:12px 16px;max-height:340px;overflow-y:auto;">
        <div style="font-size:12px;color:#888;margin-bottom:8px;">아래 상품 중 하나를 선택하면 교체됩니다</div>
        <div id="cmpModalList" style="display:flex;flex-direction:column;gap:8px;">
          ${listHTML}
        </div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('compareFullModal').remove()"
          style="padding:9px 20px;border:1.5px solid #ddd;border-radius:8px;
                 background:#fff;color:#666;font-size:13px;font-weight:600;cursor:pointer;">
          취소
        </button>
      </div>
    </div>
  `;

  // 배경 클릭 시 닫기
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.body.appendChild(modal);

  // 모달 행 hover 스타일 동적 적용
  modal.querySelectorAll('.cmp-modal-row').forEach(row => {
    row.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 12px;
      border:1.5px solid #e8e8e8;border-radius:10px;cursor:pointer;transition:all 0.15s;`;
    row.addEventListener('mouseenter', () => {
      row.style.background = '#EBF5FF';
      row.style.borderColor = '#1976D2';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
      row.style.borderColor = '#e8e8e8';
    });
  });

  // 새 아이템을 임시 저장 (replaceCompareItem에서 사용)
  window._pendingCompareItem = newItem;
}

function replaceCompareItem(removeIdx, newItemId) {
  const newItem = window._pendingCompareItem;
  if (!newItem) return;

  const removedTitle = (state.compareList[removeIdx]?.title || '').slice(0, 14);
  state.compareList.splice(removeIdx, 1);
  state.compareList.push(newItem);

  localStorage.setItem('compareList', JSON.stringify(state.compareList));
  refreshCards();
  updateCompareBadge();

  document.getElementById('compareFullModal')?.remove();
  window._pendingCompareItem = null;

  showToast(`"${removedTitle}.." 제거 → 새 상품 추가됐어요!`);
  if (state.currentPage === 'compare') renderCompare();
}

function updateCompareBadge() {
  const badge = document.getElementById('compareCountBadge');
  if (badge) badge.textContent = `${state.compareList.length} / ${MAX_COMPARE}`;
}

/* =========================================================
   비교 페이지 – 체크박스 + 저장 (완전 재작성)
   체크 상태: Set<number> (인덱스 기반 – id 특수문자 무관)
   ========================================================= */
let checkedIndexes = new Set();   // 현재 체크된 카드 인덱스 모음

/* ─────────────────────────────────────────
   renderCompare : 그리드 전체 재렌더링
───────────────────────────────────────── */
function renderCompare() {
  const grid    = document.getElementById('compareItems');
  const empty   = document.getElementById('compareEmpty');
  const toolbar = document.getElementById('compareToolbar');

  updateCompareBadge();
  checkedIndexes.clear();          // 렌더할 때마다 선택 초기화

  /* ── 비어있을 때 ── */
  if (state.compareList.length === 0) {
    grid.innerHTML    = '';
    empty.style.display   = 'block';
    toolbar.style.display = 'none';
    _syncCheckAllUI();
    return;
  }

  empty.style.display   = 'none';
  toolbar.style.display = 'flex';
  grid.innerHTML        = '';

  state.compareList.forEach((item, idx) => {
    const naverLink = (item.shops && item.shops[0])
      ? item.shops[0].url
      : (item.link || '#');
    const shortLink = naverLink.length > 46
      ? naverLink.substring(0, 46) + '…'
      : naverLink;

    /* ── 카드 DOM ── */
    const card = document.createElement('div');
    card.className    = 'compare-card';
    card.dataset.idx  = String(idx);

    card.innerHTML = `
      <div class="cmp-card-top">
        <label class="cmp-card-chk-label">
          <input type="checkbox" class="cmp-card-chk-input">
          <span class="cmp-card-chk-box"></span>
          <span class="cmp-card-chk-text">선택</span>
        </label>
        <button class="cmp-card-remove" type="button" title="이 상품 제거"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="cmp-card-overlay"></div>

      <img class="cmp-card-img"
           src="${item.image ? escHtml(item.image) : ''}"
           alt="${escHtml(item.title)}"
           onerror="this.src='https://via.placeholder.com/400x400?text=No+Image'">

      <div class="cmp-card-body">
        <div class="cmp-card-num">상품 #${idx + 1}</div>
        <div class="cmp-card-title">${escHtml(item.title)}</div>

        <div class="cmp-info-table">
          <div class="cmp-info-row">
            <div class="cmp-info-key">상품코드</div>
            <div class="cmp-info-val">${escHtml(String(item.id || '-'))}</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">브랜드</div>
            <div class="cmp-info-val">${escHtml(item.brand || '-')}</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">카테고리</div>
            <div class="cmp-info-val">${escHtml(item.category || '-')}</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">최저가</div>
            <div class="cmp-info-val v-price">${(item.lprice || 0).toLocaleString()}원</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">판매몰</div>
            <div class="cmp-info-val">${escHtml(item.mall || '-')}</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">링크</div>
            <div class="cmp-info-val v-link">
              <a href="${escHtml(naverLink)}" target="_blank" rel="noopener">${escHtml(shortLink)}</a>
            </div>
          </div>
        </div>

        <button class="cmp-detail-btn" type="button"> 쇼핑몰별 가격 비교 →</button>
      </div>
    `;

    /* ── 체크 레이블 클릭 ── */
    card.querySelector('.cmp-card-chk-label').addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleCardCheck(card, idx);
    });

    /* ── 카드 본문 클릭 → 체크 토글 (버튼·링크 제외) ── */
    card.addEventListener('click', (e) => {
      if (e.target.closest('.cmp-card-remove')  ||
          e.target.closest('.cmp-detail-btn')    ||
          e.target.closest('.cmp-card-chk-label')||
          e.target.tagName === 'A') return;
      _toggleCardCheck(card, idx);
    });

    /* ── 삭제(✕) 버튼 ── */
    card.querySelector('.cmp-card-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(card.dataset.idx, 10);
      state.compareList.splice(i, 1);
      localStorage.setItem('compareList', JSON.stringify(state.compareList));
      refreshCards();
      renderCompare();
      showToast('비교 목록에서 제거됐어요');
    });

    /* ── 쇼핑몰별 가격 비교 버튼 ── */
    card.querySelector('.cmp-detail-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showDetail(item);
    });

    grid.appendChild(card);
  });

  _updateSelCount();
  _syncCheckAllUI();
}

/* ─────────────────────────────────────────
   내부 헬퍼
───────────────────────────────────────── */

/** 카드 하나의 체크 상태를 토글 */
function _toggleCardCheck(card, idx) {
  const nowChecked = card.classList.contains('is-checked');
  _setCardCheck(card, idx, !nowChecked);
}

/** 카드 체크 상태 강제 설정 */
function _setCardCheck(card, idx, checked) {
  const inp = card.querySelector('.cmp-card-chk-input');
  if (checked) {
    checkedIndexes.add(idx);
    card.classList.add('is-checked');
    if (inp) inp.checked = true;
  } else {
    checkedIndexes.delete(idx);
    card.classList.remove('is-checked');
    if (inp) inp.checked = false;
  }
  _updateSelCount();
  _syncCheckAllUI();
}

/** 선택 카운트 텍스트 갱신 */
function _updateSelCount() {
  const el = document.getElementById('selectedCount');
  if (el) el.textContent = `${checkedIndexes.size}개 선택됨`;
}

/** 전체선택 체크박스 UI 동기화 */
function _syncCheckAllUI() {
  const total = state.compareList.length;
  const label = document.getElementById('checkAllLabel');
  const inp   = document.getElementById('checkAll');
  const allChecked = total > 0 && checkedIndexes.size === total;
  if (label) label.classList.toggle('is-checked', allChecked);
  if (inp)   inp.checked = allChecked;
}

/** 체크된 아이템 배열 반환 (없으면 전체) */
function _getTargets() {
  if (checkedIndexes.size > 0) {
    return Array.from(checkedIndexes)
      .sort((a, b) => a - b)
      .map(i => state.compareList[i])
      .filter(Boolean);
  }
  return [...state.compareList];
}

/* ─────────────────────────────────────────
   전체선택 토글 (툴바 체크박스)
───────────────────────────────────────── */
function toggleCheckAll(el) {
  /* el = hidden checkbox – checked 상태를 먼저 토글한 뒤 처리 */
  el.checked = !el.checked;          // 레이블 클릭이므로 직접 토글
  const shouldCheck = el.checked;
  checkedIndexes.clear();

  document.querySelectorAll('#compareItems .compare-card').forEach((card, idx) => {
    _setCardCheck(card, idx, shouldCheck);
  });
  _updateSelCount();
  _syncCheckAllUI();
}

/* ─────────────────────────────────────────
   선택 삭제
───────────────────────────────────────── */
function deleteSelected() {
  if (checkedIndexes.size === 0) {
    showToast('삭제할 상품을 먼저 체크해주세요');
    return;
  }
  const sortedIdxs = Array.from(checkedIndexes).sort((a, b) => b - a);
  const cnt = sortedIdxs.length;
  sortedIdxs.forEach(i => state.compareList.splice(i, 1));
  localStorage.setItem('compareList', JSON.stringify(state.compareList));
  refreshCards();
  renderCompare();
  showToast(`${cnt}개 상품이 삭제됐어요`);
}

/* ─────────────────────────────────────────
   📄 텍스트(.txt) 저장
   저장 내용: 상품코드 · 최저가 · 링크
───────────────────────────────────────── */
function exportSelectedText() {
  const targets = _getTargets();
  if (targets.length === 0) {
    showToast('비교 목록이 비어있어요');
    return;
  }

  const now  = new Date().toLocaleString('ko-KR');
  const BAR1 = '='.repeat(62);
  const BAR2 = '-'.repeat(62);
  const sel  = checkedIndexes.size > 0 ? `선택 ${checkedIndexes.size}개` : `전체 ${targets.length}개`;

  let txt = '';
  txt += `${BAR1}\n`;
  txt += `  싸카스포츠 가격비교 결과\n`;
  txt += `  저장일시 : ${now}\n`;
  txt += `  저장범위 : ${sel}\n`;
  txt += `${BAR1}\n\n`;

  targets.forEach((item, i) => {
    const naverLink = (item.shops && item.shops[0])
      ? item.shops[0].url
      : (item.link || '-');

    txt += `[${i + 1}] ${item.title || '(상품명 없음)'}\n`;
    txt += `${BAR2}\n`;
    txt += `  상품코드  : ${item.id || '-'}\n`;
    txt += `  브랜드    : ${item.brand || '-'}\n`;
    txt += `  카테고리  : ${item.category || '-'}\n`;
    txt += `  최저가    : ${(item.lprice || 0).toLocaleString()} 원\n`;
    txt += `  판매몰    : ${item.mall || '-'}\n`;
    txt += `  상품링크  : ${naverLink}\n`;

    /* 쇼핑몰별 가격 목록 */
    if (item.shops && item.shops.length > 0) {
      txt += `  ─ 쇼핑몰별 가격\n`;
      item.shops.forEach(shop => {
        const badge = shop.badge ? ` [${shop.badge}]` : '';
        txt += `    · ${shop.name}${badge} : ${(shop.price || 0).toLocaleString()} 원\n`;
        txt += `      링크 : ${shop.url || '-'}\n`;
      });
    }
    txt += '\n';
  });

  txt += `${BAR1}\n`;
  txt += `※ 싸카스포츠 가격비교 사이트 (네이버 쇼핑 API 연동)\n`;

  _downloadFile(txt, `싸카스포츠_가격비교_${_nowStr()}.txt`, 'text/plain;charset=utf-8');
  showToast(`텍스트 저장 완료! (${targets.length}개 상품)`);
}

/* ─────────────────────────────────────────
    엑셀(.csv) 저장
   저장 내용: 상품코드 · 최저가 · 링크 + 전체 필드
───────────────────────────────────────── */
function exportSelectedCSV() {
  const targets = _getTargets();
  if (targets.length === 0) {
    showToast('비교 목록이 비어있어요');
    return;
  }

  const BOM     = '\uFEFF';  // UTF-8 BOM – 엑셀 한글 깨짐 방지
  const headers = ['번호', '상품코드', '상품명', '브랜드', '카테고리',
                   '최저가(원)', '판매몰', '상품링크'];

  const q = (v) => `"${String(v || '').replace(/"/g, '""')}"`;  // CSV 안전 감싸기

  const rows = targets.map((item, i) => {
    const naverLink = (item.shops && item.shops[0])
      ? item.shops[0].url
      : (item.link || '');
    return [
      i + 1,
      q(item.id),
      q(item.title),
      q(item.brand),
      q(item.category),
      item.lprice || 0,
      q(item.mall),
      q(naverLink)
    ].join(',');
  });

  const csv = BOM + [headers.join(','), ...rows].join('\n');
  _downloadFile(csv, `싸카스포츠_가격비교_${_nowStr()}.csv`, 'text/csv;charset=utf-8');
  showToast(`엑셀(CSV) 저장 완료! (${targets.length}개 상품)`);
}

/* ─────────────────────────────────────────
   하위 호환: 구 함수명 → 새 함수명 매핑
───────────────────────────────────────── */
function exportExcel()  { exportSelectedCSV(); }
function exportText()   { exportSelectedText(); }
function updateSelectedCount() { _updateSelCount(); }
function syncCheckAll()        { _syncCheckAllUI(); }

/* ─────────────────────────────────────────
   파일 다운로드 공통 헬퍼
───────────────────────────────────────── */
function _downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _nowStr() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`
       + `_${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}`;
}

/* 하위호환 별칭 */
function getNowStr() { return _nowStr(); }
function downloadFile(c, f, m) { _downloadFile(c, f, m); }

/* ===== 유틸 ===== */
function findItemById(id) {
  // 1순위: 내부 레지스트리 (shops 완전 보존)
  const regItem = _getItem(id);
  if (regItem) return regItem;

  // 2순위: DOM 카드에서 직접 참조
  const grids = ['homeGrid', 'searchGrid', 'wishlistGrid'];
  for (const gid of grids) {
    const grid = document.getElementById(gid);
    if (grid) {
      const cards = grid.querySelectorAll('.product-card');
      for (const card of cards) {
        if (card._item && card._item.id === id) {
          _registerItem(card._item); // 레지스트리에 등록
          return card._item;
        }
      }
    }
  }
  // 3순위: wishlist/compare에서도 찾기
  let found = state.wishlist.find(w => w.id === id);
  if (found) return found;
  found = state.compareList.find(c => c.id === id);
  return found || null;
}

function refreshCards() {
  // 모든 카드 위시/비교 버튼 상태 갱신
  document.querySelectorAll('.product-card').forEach(card => {
    if (!card._item) return;
    const id = card._item.id;
    const isWished = state.wishlist.some(w => w.id === id);
    const isCompared = state.compareList.some(c => c.id === id);

    const wishBtn = card.querySelector('.card-action-btn:nth-child(1)');
    const compareBtn = card.querySelector('.card-action-btn:nth-child(2)');
    const compareFooterBtn = card.querySelector('.card-compare-btn');

    if (wishBtn) {
      wishBtn.innerHTML = isWished ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#e53935" stroke="#e53935" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
      wishBtn.classList.toggle('wishlisted', isWished);
    }
    if (compareBtn) {
      compareBtn.classList.toggle('wishlisted', isCompared);
    }
    if (compareFooterBtn) {
      compareFooterBtn.textContent = isCompared ? '✓ 비교중' : '+ 비교하기';
    }
  });
}

function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('open');
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

/* ==========================================================
   엑셀 일괄검색 기능 (v2 - 완전 개선)
   ========================================================== */

/* 엑셀 상태 */
const excelState = {
  items: [],           // 파싱된 상품명 배열
  results: [],         // 검색 결과 [{name, top3:[{rank,title,image,lprice,mall,link,item}]}]
  isSearching: false,
  cancelRequested: false,  // 취소 플래그
};

/* 드래그앤드롭 초기화 - input은 항상 DOM에 유지하므로 한 번만 등록 */
document.addEventListener('DOMContentLoaded', function() {
  var zone = document.getElementById('excelDropZone');
  var inp  = document.getElementById('excelFileInput');
  if (!zone) return;

  /* ── file input change 이벤트: 인라인 onchange 대신 addEventListener 사용 ──
     이유: 인라인 onchange는 일부 브라우저에서 같은 파일 재선택 시 발동 안 됨.
     addEventListener + inp.value='' 조합이 가장 안전함. */
  if (inp) {
    inp.addEventListener('change', function() {
      var file = this.files && this.files[0];
      /* value 즉시 초기화 → 같은 파일 또는 재업로드 시 change 항상 발동 */
      this.value = '';
      if (file) handleExcelFile(file);
    });
  }

  zone.addEventListener('dragover', function(e) {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', function(e) {
    if (!zone.contains(e.relatedTarget)) {
      zone.classList.remove('drag-over');
    }
  });
  zone.addEventListener('drop', function(e) {
    e.preventDefault();
    zone.classList.remove('drag-over');
    var file = e.dataTransfer.files[0];
    if (file) handleExcelFile(file);
  });
  zone.addEventListener('click', function(e) {
    // BUTTON·INPUT·A 클릭은 자체 처리
    var tag = e.target.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'A') return;
    // 완료 뷰가 표시 중일 땐 zone 클릭 무시
    var doneView = document.getElementById('uploadDoneView');
    if (doneView && doneView.style.display !== 'none') return;
    if (inp) inp.click();
  });
});

/* 파일 처리
   ※ inp.value 초기화는 change 이벤트 핸들러(DOMContentLoaded)에서 처리.
      여기서는 File 객체만 받아서 파싱 수행. */
function handleExcelFile(file) {
  if (!file) return;

  // XLSX 라이브러리 로드 확인
  if (typeof XLSX === 'undefined') {
    showToast('엑셀 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.');
    return;
  }

  var ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls','csv'].includes(ext)) {
    showToast('.xlsx, .xls, .csv 파일만 지원합니다');
    return;
  }

  // 업로드존 비활성화 (파싱 중 중복 업로드 방지)
  var zone = document.getElementById('excelDropZone');
  if (zone) zone.style.pointerEvents = 'none';

  var reader = new FileReader();
  reader.onload = function(evt) {
    try {
      var data = new Uint8Array(evt.target.result);
      var wb   = XLSX.read(data, { type: 'array' });
      var ws   = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // A열(index 0) 값 추출, 빈값 제거, 최대 200개
      var names = [];
      rows.forEach(function(row) {
        var val = String(row[0] || '').trim();
        if (val && val.length > 0) names.push(val);
      });
      names = names.slice(0, 200);

      if (names.length === 0) {
        showToast('A열에 상품명이 없습니다. 파일을 확인해주세요.');
        return;  // finally에서 zone 복원됨
      }
      excelState.items   = names;
      excelState.results = [];
      _renderExcelPreview(names, file.name);
      // 업로드 완료 → 업로드존 축소 + 스크롤
      _collapseUploadZone(file.name);
    } catch(err) {
      showToast('파일 읽기 실패: ' + err.message);
    } finally {
      // 업로드존 포인터 이벤트 반드시 복원 (성공·실패·빈파일 모두)
      if (zone) zone.style.pointerEvents = '';
    }
  };
  reader.onerror = function() {
    showToast('파일을 읽을 수 없습니다.');
    if (zone) zone.style.pointerEvents = '';
  };
  reader.readAsArrayBuffer(file);
}

/* 업로드 완료 후 업로드존 축소 - innerHTML 교체 없이 CSS 토글 */
function _collapseUploadZone(fileName) {
  var zone        = document.getElementById('excelDropZone');
  var defaultView = document.getElementById('uploadDefaultView');
  var doneView    = document.getElementById('uploadDoneView');
  var doneText    = document.getElementById('uploadDoneFileName');
  if (!zone) return;

  // 완료 상태로 전환
  if (defaultView) defaultView.style.display = 'none';
  if (doneView)    doneView.style.display     = 'flex';
  if (doneText)    doneText.textContent       = ' ' + fileName + ' 업로드 완료';

  zone.style.padding     = '14px 20px';
  zone.style.cursor      = 'default';
  zone.style.background  = '#f0faf0';
  zone.style.borderColor = '#66bb6a';

  // 미리보기 영역으로 스크롤
  setTimeout(function() {
    var preview = document.getElementById('excelPreviewWrap');
    if (preview) preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
}

/* 미리보기 렌더링 */
function _renderExcelPreview(names, fileName) {
  document.getElementById('excelPreviewWrap').style.display  = 'block';
  document.getElementById('excelResultWrap').style.display   = 'none';
  document.getElementById('excelProgressWrap').style.display = 'none';

  var validCount = names.filter(function(n) { return n.length >= 2; }).length;
  document.getElementById('excelPreviewCount').innerHTML =
    ' <strong>' + names.length + '개</strong> 상품 인식' +
    (fileName ? ' <span class="file-name-badge">' + escHtml(fileName) + '</span>' : '') +
    (validCount < names.length ? ' <span style="color:#e53935;font-size:12px;">(너무 짧은 이름 ' + (names.length - validCount) + '개 제외)</span>' : '');

  var list = document.getElementById('excelPreviewList');
  list.innerHTML = '';
  names.forEach(function(name, i) {
    var invalid = name.length < 2;
    var chip = document.createElement('span');
    chip.className = 'excel-preview-chip' + (invalid ? ' invalid' : '');
    chip.title = invalid ? '검색에서 제외됩니다 (너무 짧음)' : name;
    chip.textContent = (i + 1) + '. ' + name;
    list.appendChild(chip);
  });

  var btn = document.getElementById('excelSearchAllBtn');
  if (btn) { btn.disabled = false; btn.textContent = '전체 최저가 검색 시작 (' + validCount + '개)'; }
}

/* 전체 일괄 검색 시작 */
async function startExcelBulkSearch() {
  if (excelState.isSearching) return;
  var names = excelState.items.filter(function(n) { return n.length >= 2; });
  if (names.length === 0) { showToast('유효한 상품명이 없습니다'); return; }

  excelState.isSearching     = true;
  excelState.cancelRequested = false;
  excelState.results         = [];

  // 버튼 상태 변경
  var startBtn  = document.getElementById('excelSearchAllBtn');
  var cancelBtn = document.getElementById('excelCancelBtn');
  if (startBtn)  startBtn.style.display  = 'none';
  if (cancelBtn) { cancelBtn.style.display = 'inline-flex'; cancelBtn.disabled = false; cancelBtn.textContent = '검색 취소'; }

  // 진행바 표시, 미리보기/결과는 숨김
  document.getElementById('excelProgressWrap').style.display = 'block';
  document.getElementById('excelResultWrap').style.display   = 'none';
  _updateExcelProgress(0, names.length, '');

  try {
    for (var i = 0; i < names.length; i++) {
      // 취소 체크
      if (excelState.cancelRequested) {
        showToast(' 검색이 취소됐습니다 (' + i + '/' + names.length + '개 완료)');
        break;
      }

      var name = names[i];
      _updateExcelProgress(i, names.length, name);

      try {
        var data = await apiSearch(name, 'asc', 1, 5, ''); // 낮은가격순 5개
        var apiItems = (data.items || []).slice(0, 3);      // Top3만 사용
        var top3 = apiItems.map(function(it, idx) {
          return {
            rank:   idx + 1,
            title:  it.title  || name,
            image:  it.image  || '',
            lprice: it.lprice || 0,
            mall:   it.mall   || '',
            link:   it.link   || '#',
            item:   it,
          };
        });
        if (top3.length === 0) {
          top3 = [{ rank: 1, title: '검색결과 없음', image: '', lprice: 0, mall: '-', link: '#', item: null }];
        }
        excelState.results.push({ name: name, top3: top3 });
      } catch(apiErr) {
        excelState.results.push({ name: name, top3: [{ rank:1, title:'API 오류', image:'', lprice:0, mall:'-', link:'#', item:null }] });
      }

      _updateExcelProgress(i + 1, names.length, name);
      // API 부하 방지: 120ms 간격
      await new Promise(function(r) { setTimeout(r, 120); });
    }
  } finally {
    // 항상 실행: 상태 복구
    excelState.isSearching = false;
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (startBtn)  { startBtn.style.display = 'inline-flex'; startBtn.disabled = false; }

    // 결과가 있으면 테이블 표시, 없으면 진행바 숨김
    if (excelState.results.length > 0) {
      _renderExcelResults(excelState.results);
    } else {
      document.getElementById('excelProgressWrap').style.display = 'none';
    }
  }
}

/* 검색 취소 */
function cancelExcelSearch() {
  if (!excelState.isSearching) return;
  excelState.cancelRequested = true;
  var cancelBtn = document.getElementById('excelCancelBtn');
  if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.textContent = '취소 중...'; }
}

/* 진행 상태 업데이트 */
function _updateExcelProgress(done, total, currentName) {
  var pct = total > 0 ? Math.round((done / total) * 100) : 0;
  var bar = document.getElementById('excelProgressBar');
  var txt = document.getElementById('excelProgressText');
  var cur = document.getElementById('excelProgressCurrent');
  if (bar) bar.style.width = pct + '%';
  if (txt) txt.textContent = done + ' / ' + total + ' (' + pct + '%)';
  if (cur && currentName) cur.textContent = '검색 중: ' + currentName;
}

/* 결과 테이블 렌더링 */
function _renderExcelResults(results) {
  document.getElementById('excelProgressWrap').style.display = 'none';
  document.getElementById('excelResultWrap').style.display   = 'block';

  // 완료 통계 업데이트
  var titleEl = document.querySelector('.excel-result-title');
  if (titleEl) {
    var noResultCount = results.filter(function(r) {
      return r.top3[0] && (r.top3[0].title === '검색결과 없음' || r.top3[0].title === 'API 오류');
    }).length;
    titleEl.innerHTML = '검색 완료 <span class="result-stat">' + results.length + '개 상품</span>' +
      (noResultCount > 0 ? ' <span class="result-stat-warn">결과없음 ' + noResultCount + '개</span>' : '');
  }

  var tbody = document.getElementById('excelResultBody');
  tbody.innerHTML = '';

  results.forEach(function(item, idx) {
    item.top3.forEach(function(row, rankIdx) {
      var tr = document.createElement('tr');
      if (rankIdx === 0) tr.classList.add('product-group-start');

      var isError = (row.title === '검색결과 없음' || row.title === 'API 오류');
      if (isError) tr.classList.add('row-error');

      // No + 검색어 셀 (rowspan)
      if (rankIdx === 0) {
        var noTd = document.createElement('td');
        noTd.className = 'col-no';
        noTd.rowSpan = item.top3.length;
        noTd.textContent = idx + 1;
        tr.appendChild(noTd);

        var nameTd = document.createElement('td');
        nameTd.className = 'col-name';
        nameTd.rowSpan = item.top3.length;
        nameTd.innerHTML = '<span class="search-keyword">' + escHtml(item.name) + '</span>';
        tr.appendChild(nameTd);
      }

      // 순위 배지
      var rankTd = document.createElement('td');
      rankTd.className = 'col-rank';
      rankTd.innerHTML = '<span class="rank-badge rank-' + row.rank + '">' + row.rank + '</span>';
      tr.appendChild(rankTd);

      // 썸네일 + 실제 상품명
      var productTd = document.createElement('td');
      productTd.className = 'col-product';
      if (isError) {
        productTd.innerHTML = '<span style="color:#aaa;">' + escHtml(row.title) + '</span>';
      } else {
        var imgHtml = row.image
          ? '<img src="' + escHtml(row.image) + '" class="excel-thumb" alt="" onerror="this.style.display=\'none\'">'
          : '<div class="excel-thumb-placeholder"></div>';
        var titleText = row.title.length > 40 ? row.title.slice(0, 40) + '…' : row.title;
        productTd.innerHTML =
          '<div class="excel-product-cell">' + imgHtml +
          '<span class="excel-product-title" title="' + escHtml(row.title) + '">' + escHtml(titleText) + '</span>' +
          '</div>';
        // 클릭 시 상세 페이지 이동
        if (row.item) {
          var savedItem = row.item;
          productTd.querySelector('.excel-product-cell').style.cursor = 'pointer';
          productTd.querySelector('.excel-product-cell').addEventListener('click', function() {
            _registerItem(savedItem);
            showDetail(savedItem);
          });
        }
      }
      tr.appendChild(productTd);

      // 최저가
      var priceTd = document.createElement('td');
      priceTd.className = 'col-price';
      priceTd.innerHTML = row.lprice > 0
        ? '<span class="excel-price' + (row.rank === 1 ? ' best' : '') + '">' + row.lprice.toLocaleString() + '원</span>'
        : '<span style="color:#aaa">-</span>';
      tr.appendChild(priceTd);

      // 쇼핑몰
      var mallTd = document.createElement('td');
      mallTd.className = 'col-mall';
      mallTd.textContent = row.mall;
      tr.appendChild(mallTd);

      // 바로가기 버튼
      var linkTd = document.createElement('td');
      linkTd.className = 'col-link';
      if (row.link !== '#' && row.lprice > 0) {
        linkTd.innerHTML = '<a href="' + escHtml(row.link) + '" target="_blank" rel="noopener" class="excel-link-btn">보기 →</a>';
      }
      tr.appendChild(linkTd);

      tbody.appendChild(tr);
    });
  });
}

/* 결과 엑셀 다운로드 (개선: 썸네일URL 포함) */
function exportExcelResult() {
  if (!excelState.results.length) { showToast('검색 결과가 없습니다'); return; }

  var rows = [['No', '검색 상품명', '순위', '실제 상품명', '최저가(원)', '쇼핑몰', '상품 링크', '이미지 URL']];
  excelState.results.forEach(function(item, idx) {
    item.top3.forEach(function(row) {
      rows.push([
        idx + 1,
        item.name,
        row.rank,
        row.title,
        row.lprice,
        row.mall,
        row.link !== '#' ? row.link : '',
        row.image || '',
      ]);
    });
  });

  var ws = XLSX.utils.aoa_to_sheet(rows);

  // 열 너비 지정
  ws['!cols'] = [
    {wch:5}, {wch:25}, {wch:5}, {wch:45}, {wch:12}, {wch:15}, {wch:50}, {wch:60}
  ];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '최저가검색결과');
  XLSX.writeFile(wb, '싸카_최저가검색_' + new Date().toISOString().slice(0,10) + '.xlsx');
  showToast('결과 엑셀 다운로드 완료! (' + excelState.results.length + '개 상품)');
}

/* 샘플 양식 다운로드
   ※ 1행은 "상품명" 헤더 → 업로드 시 반드시 삭제 안내 포함 */
function downloadExcelTemplate() {
  var rows = [
    ['상품명'],                              // ← 1행: 헤더 (업로드 전 이 행 삭제)
    ['IQ3579400'],
    ['IO8226900'],
    ['아디다스 레알마드리드 유니폼'],
    ['나이키 메르쿠리알 축구화'],
    ['오클리 선글라스'],
    ['대한민국 국가대표 유니폼'],
    ['푸마 트레이닝복'],
  ];
  var ws = XLSX.utils.aoa_to_sheet(rows);

  // 1행(헤더) 강조: 배경색 + 굵게 + 안내 코멘트
  if (!ws['A1']) ws['A1'] = {};
  ws['A1'].s = {
    fill: { fgColor: { rgb: 'FFD700' } },
    font: { bold: true },
    alignment: { horizontal: 'center' }
  };

  ws['!cols'] = [{wch: 35}];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '상품목록');
  XLSX.writeFile(wb, '싸카_검색양식샘플.xlsx');
  showToast('샘플 양식 다운로드 완료 — 1행(상품명 헤더)을 삭제 후 업로드하세요');
}

/* 초기화 */
function resetExcelPage() {
  excelState.items          = [];
  excelState.results        = [];
  excelState.isSearching    = false;
  excelState.cancelRequested = false;
  document.getElementById('excelPreviewWrap').style.display  = 'none';
  document.getElementById('excelProgressWrap').style.display = 'none';
  document.getElementById('excelResultWrap').style.display   = 'none';
  // 버튼 복구
  var startBtn = document.getElementById('excelSearchAllBtn');
  var cancelBtn = document.getElementById('excelCancelBtn');
  if (startBtn)  { startBtn.style.display = 'inline-flex'; startBtn.disabled = false; startBtn.textContent = '전체 최저가 검색 시작'; }
  if (cancelBtn) { cancelBtn.style.display = 'none'; cancelBtn.disabled = false; cancelBtn.textContent = '검색 취소'; }
  // 업로드존 원래대로 복원
  _restoreUploadZone();
}

/* 업로드존 원래 상태로 복원 - CSS 토글만 */
function _restoreUploadZone() {
  var zone        = document.getElementById('excelDropZone');
  var defaultView = document.getElementById('uploadDefaultView');
  var doneView    = document.getElementById('uploadDoneView');
  var inp         = document.getElementById('excelFileInput');
  if (!zone) return;

  // 기본 상태로 전환
  if (defaultView) defaultView.style.display = '';
  if (doneView)    doneView.style.display     = 'none';
  if (inp)         inp.value                 = '';  // 같은 파일 재선택 가능

  zone.style.padding     = '';
  zone.style.cursor      = 'pointer';
  zone.style.background  = '';
  zone.style.borderColor = '';
}

/* ===== 초기 로드 ===== */
window.addEventListener('DOMContentLoaded', () => {
  // localStorage에서 불러온 아이템을 registry에 등록
  state.wishlist.forEach(item => _registerItem(item));
  state.compareList.forEach(item => _registerItem(item));

  // 초기 로딩 없음 - 탭 클릭 시에만 상품 로드 (속도 최적화)
  _showHomeGuide();
});
