/* Product media stays in the existing authenticated multipart Save/Publish flow. */
(() => {
  'use strict';
  const root = document.querySelector('#garment-photo-editor');
  if (!root) return;

  const main = root.querySelector('[name=main_image]');
  const link = root.querySelector('[name=main_image_link]');
  const remove = root.querySelector('[name=remove_main_image]');
  const gallery = root.querySelector('[name=gallery_images]');
  const links = root.querySelector('[name=gallery_image_links]');
  const preview = root.querySelector('[data-gallery-preview]');
  const status = root.querySelector('[data-media-status]');
  const mainPhotoWrap = root.querySelector('[data-main-photo]');
  const savedMain = (mainPhotoWrap && mainPhotoWrap.dataset.saved) ? mainPhotoWrap.dataset.saved.trim() : '';

  let selected = [];
  let objectUrls = [];
  const saved = preview ? Array.from(preview.children).map(node => ({
    url: node.dataset.savedPhoto || '',
    index: node.dataset.index || ''
  })).filter(item => item.url) : [];
  const deleted = new Set();

  const say = text => {
    if (status) status.textContent = text;
  };

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function validateImageUrl(value) {
    if (!value || !value.trim()) return { valid: true, empty: true };
    const trimmed = value.trim();
    let urlObj;
    try {
      urlObj = new URL(trimmed);
    } catch {
      return { valid: false, error: 'Enter a valid URL starting with https://' };
    }
    if (urlObj.protocol !== 'https:') {
      return { valid: false, error: 'Only secure HTTPS image URLs are supported' };
    }
    const hostname = urlObj.hostname.toLowerCase();
    const isSearchOrWebEngine = /^(.*\.)?(google\.[a-z.]+|bing\.com|yahoo\.com|duckduckgo\.com|baidu\.com|yandex\.[a-z.]+|pinterest\.com|facebook\.com|instagram\.com)$/i.test(hostname);
    if (isSearchOrWebEngine) {
      return { valid: false, error: 'Search engine / webpage links are not direct image files. Use a direct URL ending in .jpg, .jpeg, .png, or .webp.' };
    }
    if (!/\.(jpe?g|png|webp)(\?.*)?$/i.test(urlObj.pathname)) {
      return { valid: false, error: 'Direct image link must end in .jpg, .jpeg, .png, or .webp' };
    }
    return { valid: true, url: urlObj.href };
  }

  function button(text, action, isDanger) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = isDanger
      ? 'margin-top:6px;padding:4px 10px;font-size:12px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;cursor:pointer;'
      : 'margin-top:6px;padding:4px 10px;font-size:12px;color:#334155;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;';
    b.onclick = action;
    return b;
  }

  function card(url, label, isError) {
    const box = document.createElement('div');
    box.style.cssText = 'max-width:220px;min-width:140px;overflow-wrap:anywhere;padding:8px;border:1px solid ' + (isError ? '#fca5a5' : '#cbd5e1') + ';border-radius:6px;background:' + (isError ? '#fff5f5' : '#ffffff') + ';';

    if (isError) {
      const errBox = document.createElement('div');
      errBox.style.cssText = 'display:flex;align-items:center;justify-content:center;height:120px;background:#fee2e2;color:#b91c1c;font-size:12px;font-weight:600;padding:8px;text-align:center;border-radius:4px;';
      errBox.textContent = url ? 'Image failed to load' : 'Invalid image URL';
      box.append(errBox);
    } else {
      const img = document.createElement('img');
      img.style.cssText = 'display:block;width:100%;height:120px;object-fit:cover;border-radius:4px;background:#f8fafc;';
      img.alt = 'Garment photo preview';
      img.onerror = () => {
        img.style.display = 'none';
        const fallback = document.createElement('div');
        fallback.style.cssText = 'display:flex;align-items:center;justify-content:center;height:120px;background:#fee2e2;color:#b91c1c;font-size:11.5px;padding:8px;text-align:center;border-radius:4px;';
        fallback.textContent = 'Preview failed to load. Check that this is a direct, public image URL.';
        box.insertBefore(fallback, box.firstChild);
      };
      img.src = url;
      box.append(img);
    }

    const text = document.createElement('p');
    text.style.cssText = 'font-size:11.5px;color:' + (isError ? '#b91c1c' : '#475569') + ';margin:6px 0 0;line-height:1.3;';
    text.textContent = label;
    box.append(text);
    return box;
  }

  function fileUrl(file) {
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    return url;
  }

  function syncFiles() {
    const dt = new DataTransfer();
    selected.forEach(file => dt.items.add(file));
    gallery.files = dt.files;
  }

  function valid(file) {
    const validExtensions = /\.(jpe?g|png|webp)$/i;
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    const hasValidExt = validExtensions.test(file.name);
    const hasValidMime = !file.type || validMimes.includes(file.type);

    if (!hasValidExt || !hasValidMime) {
      say('File "' + file.name + '" not selected. Use real JPG, PNG, or WebP image files.');
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      say('File "' + file.name + '" exceeds 10 MB limit (' + formatBytes(file.size) + ').');
      return false;
    }
    return true;
  }

  function render() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls = [];

    // 1. Main photo preview
    const area = root.querySelector('[data-main-preview]');
    if (area) {
      area.replaceChildren();
      const file = main.files && main.files[0];
      const linkVal = link ? link.value.trim() : '';
      const urlCheck = linkVal ? validateImageUrl(linkVal) : null;

      if (file) {
        const url = fileUrl(file);
        area.append(card(url, 'Selected upload: ' + file.name + ' (' + formatBytes(file.size) + ') — Save/Publish to upload'));
      } else if (linkVal) {
        if (urlCheck && !urlCheck.valid) {
          link.setCustomValidity(urlCheck.error);
          area.append(card('', 'Invalid URL: ' + urlCheck.error, true));
        } else {
          link.setCustomValidity('');
          area.append(card(linkVal, 'Image URL: ' + linkVal + ' — Save/Publish to apply'));
        }
      } else if (savedMain && (!remove || !remove.value)) {
        area.append(card(savedMain, 'Saved: ' + savedMain.split('/').pop()));
      } else {
        const emptyMsg = document.createElement('p');
        emptyMsg.style.cssText = 'font-size:12.5px;color:#64748b;margin:8px 0;';
        emptyMsg.textContent = remove && remove.value ? 'Main photo marked for removal. Save/Publish to apply.' : 'No main photo selected.';
        area.append(emptyMsg);
      }
    }

    // 2. Gallery photos preview
    if (preview) {
      preview.replaceChildren();

      // Saved gallery photos
      saved.forEach(item => {
        if (deleted.has(item.index)) return;
        const box = card(item.url, 'Saved: ' + item.url.split('/').pop());
        box.append(button('Delete', () => {
          if (!confirm('Remove this saved gallery photo? Save or Publish to apply changes.')) return;
          deleted.add(item.index);
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'remove_gallery_image';
          input.value = item.index;
          root.append(input);
          say('Gallery photo removed from this edit. Save or Publish to apply.');
          render();
        }, true));
        preview.append(box);
      });

      // Newly selected uploads
      selected.forEach((file, index) => {
        const box = card(fileUrl(file), 'Selected: ' + file.name + ' (' + formatBytes(file.size) + ') — Save/Publish to upload');
        box.append(button('Delete', () => {
          selected.splice(index, 1);
          syncFiles();
          render();
          say('Selected gallery photo removed.');
        }, true));
        preview.append(box);
      });

      // Linked HTTPS URLs
      if (links) {
        const rawUrls = links.value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
        const uniqueUrls = [...new Set(rawUrls)];
        uniqueUrls.forEach((url, index) => {
          const check = validateImageUrl(url);
          const box = card(url, check.valid ? 'URL: ' + url : 'Invalid URL: ' + check.error, !check.valid);
          box.append(button('Delete', () => {
            uniqueUrls.splice(index, 1);
            links.value = uniqueUrls.join('\n');
            render();
          }, true));
          preview.append(box);
        });
      }
    }
  }

  // Event Listeners
  main.addEventListener('change', () => {
    if (main.files && main.files[0]) {
      if (!valid(main.files[0])) {
        main.value = '';
      } else {
        if (link) {
          link.value = '';
          link.setCustomValidity('');
        }
        if (remove) remove.value = '';
        say('Main photo ready: ' + main.files[0].name + '. Save or Publish to upload.');
      }
    }
    render();
  });

  if (link) {
    link.addEventListener('input', () => {
      const val = link.value.trim();
      if (val) {
        main.value = '';
        if (remove) remove.value = '';
        const check = validateImageUrl(val);
        if (!check.valid) {
          link.setCustomValidity(check.error);
          say(check.error);
        } else {
          link.setCustomValidity('');
          say('Valid image URL provided. Save or Publish to apply.');
        }
      } else {
        link.setCustomValidity('');
      }
      render();
    });
  }

  const removeMainBtn = root.querySelector('[data-remove-main]');
  if (removeMainBtn) {
    removeMainBtn.onclick = () => {
      if (savedMain && (!remove || !remove.value)) {
        if (!confirm('Remove the main garment photo? Save or Publish to apply.')) return;
      }
      main.value = '';
      if (link) {
        link.value = '';
        link.setCustomValidity('');
      }
      if (remove) remove.value = 'on';
      say('Main photo marked for removal. Save or Publish to apply.');
      render();
    };
  }

  gallery.addEventListener('change', () => {
    const incoming = Array.from(gallery.files || []);
    say('Checking gallery photos...');
    for (const file of incoming) {
      if (!valid(file)) continue;
      if (selected.some(old => old.name === file.name && old.size === file.size && old.lastModified === file.lastModified)) {
        say('Duplicate file skipped: ' + file.name);
        continue;
      }
      if (selected.length >= 10) {
        say('You can select up to 10 new gallery photos per upload.');
        break;
      }
      selected.push(file);
    }
    syncFiles();
    render();
    say(selected.length + ' new gallery photo(s) ready. Save or Publish to upload.');
  });

  if (links) {
    links.addEventListener('input', () => {
      render();
    });
  }

  const form = root.closest('form');
  if (form) {
    form.addEventListener('submit', () => {
      say('Uploading and saving photos... Please wait.');
    });
  }

  render();
})();
