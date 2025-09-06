 (function(){
    'use strict';

    /* helpers */
    function $ (sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$ (sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

    /* normalize product JSON (server or fetched /products/<handle>.js) */
    function normalizeProduct(raw){
      if(!raw) return null;
      var p = {};
      p.id = raw.id || null;
      p.handle = raw.handle || null;
      p.title = raw.title || 'Product';
      p.description = raw.body_html || raw.description || '';
      p.currency = raw.currency || raw.currency_code || '';
      p.images = [];
      if(Array.isArray(raw.images)){
        raw.images.forEach(function(i){ if(!i) return; if(typeof i === 'string') p.images.push(i); else if(i.src) p.images.push(i.src); });
      }
      if(p.images.length === 0 && raw.featured_image){
        if(typeof raw.featured_image === 'string') p.images.push(raw.featured_image);
        else if(raw.featured_image.src) p.images.push(raw.featured_image.src);
      }
      p.options = Array.isArray(raw.options) ? raw.options.slice() : [];
      p.variants = [];
      if(Array.isArray(raw.variants)){
        raw.variants.forEach(function(v){
          var variant = {};
          variant.id = v.id;
          variant.title = v.title || '';
          variant.price = (typeof v.price === 'number') ? v.price : (parseInt(v.price,10) || 0);
          variant.available = (typeof v.available === 'boolean') ? v.available : (v.available !== '0' && v.available !== 0);
          variant.options = Array.isArray(v.options) ? v.options.slice() : [v.option1, v.option2, v.option3].filter(function(x){ return x !== null && x !== undefined; });
          variant.image = (v.featured_image && v.featured_image.src) ? v.featured_image.src : (v.image && v.image.src ? v.image.src : (p.images[0] || null));
          p.variants.push(variant);
        });
      }
      p.options_with_values = (p.options || []).map(function(name, idx){
        var values = [];
        p.variants.forEach(function(v){ if(v.options && v.options[idx] !== undefined && values.indexOf(v.options[idx]) === -1) values.push(v.options[idx]); });
        return { name: name, values: values };
      });
      // include a server-formatted price if present (helps locale formatting). If Liquid injected price_formatted, use it:
      if(raw.price_formatted) p.price_formatted = raw.price_formatted;
      return p;
    }

    function findVariant(product, selectedOptions){
      if(!product || !product.variants) return null;
      return product.variants.find(function(v){
        for(var i=0;i<selectedOptions.length;i++){
          if((v.options[i] || '') !== (selectedOptions[i] || '')) return false;
        }
        return true;
      }) || null;
    }

    function formatPrice(cents, currency) {
      if(typeof cents === 'string' && cents.trim().length > 0) return cents; // already formatted
      try {
        var n = Number(cents);
        if(isNaN(n)) return cents || '';
        return (n/100).toFixed(2) + (currency ? ' ' + currency : '');
      } catch(e) { return ''; }
    }

    function buildCard(product){
      var card = document.createElement('div'); card.className = 'lb-card'; card.tabIndex = 0;

      var thumb = document.createElement('div'); thumb.className = 'lb-thumb';
      var img = document.createElement('img'); img.alt = product.title; img.src = product.images && product.images[0] ? product.images[0] : '';
      thumb.appendChild(img);

      var body = document.createElement('div'); body.className = 'lb-body';
      var title = document.createElement('h3'); title.className = 'lb-title'; title.textContent = product.title;
      var sub = document.createElement('div'); sub.className = 'lb-sub';
      sub.innerHTML = product.description ? (product.description.replace(/(<([^>]+)>)/gi, "").substring(0,120) + (product.description.length>120?'...':'')) : '';
      var price = document.createElement('div'); price.className = 'lb-price';
      price.textContent = product.price_formatted || (product.variants && product.variants[0] ? formatPrice(product.variants[0].price, product.currency) : '');

      body.appendChild(title);
      if(sub.textContent) body.appendChild(sub);
      body.appendChild(price);

      var controls = document.createElement('div'); controls.className = 'lb-controls';

      var selects = [];
      (product.options_with_values || []).forEach(function(opt, idx){
        var sel = document.createElement('select'); sel.className = 'lb-select'; sel.setAttribute('aria-label', product.title + ' — ' + opt.name); sel.setAttribute('data-option-index', idx);
        opt.values.forEach(function(val){ var o = document.createElement('option'); o.value = val; o.textContent = val; sel.appendChild(o); });
        if(!opt.values || opt.values.length === 0){ var o = document.createElement('option'); o.value=''; o.textContent='—'; o.disabled=true; sel.appendChild(o); }
        selects.push(sel); controls.appendChild(sel);
      });

      var qty = document.createElement('input'); qty.type='number'; qty.className='lb-qty'; qty.min='1'; qty.value='1'; qty.setAttribute('aria-label', product.title + ' quantity');
      controls.appendChild(qty);

      var btn = document.createElement('button'); btn.type='button'; btn.className='lb-add'; btn.textContent='Add to bag';
      btn.setAttribute('aria-label', 'Add ' + product.title + ' to bag');
      controls.appendChild(btn);

      body.appendChild(controls);
      card.appendChild(thumb); card.appendChild(body);

      // update UI when selects change
      function getSelectedOptions(){ return selects.map(function(s){ return s.value; }); }
      function updateUI(){
        var selected = getSelectedOptions();
        var variant = findVariant(product, selected) || product.variants[0];
        if(!variant) return;
        price.textContent = product.price_formatted || formatPrice(variant.price, product.currency);
        if(variant.image) img.src = variant.image;
      }
      selects.forEach(function(s){ s.addEventListener('change', updateUI); });

      /* ADD TO CART (AJAX) + robust Dawn cart update */
      btn.addEventListener('click', function(){
        var selected = getSelectedOptions();
        var variant = findVariant(product, selected) || product.variants[0];
        if(!variant || !variant.id){ window.alert('Please select a valid variant for ' + product.title); return; }
        var quantity = Math.max(1, parseInt(qty.value, 10) || 1);

        btn.disabled = true;
        var oldTxt = btn.textContent;
        btn.textContent = 'Adding...';

        // AJAX add
        fetch('/cart/add.js', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ id: variant.id, quantity: quantity })
        }).then(function(r){
          if(!r.ok) return r.json().then(function(err){ throw err; });
          return r.json();
        }).then(function(added){
          // fetch latest cart JSON
          return fetch('/cart.js', { credentials: 'same-origin' }).then(function(r){ return r.json(); });
        }).then(function(cart){
          // 1) dispatch custom events (other scripts/themes can listen)
          document.dispatchEvent(new CustomEvent('lookbook:cart-updated', { detail: cart }));
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
          document.dispatchEvent(new CustomEvent('cart_changed', { detail: cart }));
          // 2) Try to call Dawn's webcomponent renderContents if present (common pattern). See community examples: renderContents() usage. :contentReference[oaicite:1]{index=1}
          try {
            var drawerEl = document.querySelector('cart-notification') || document.querySelector('cart-drawer') || document.querySelector('#cart-drawer') || document.querySelector('cart-notification');
            if (drawerEl && typeof drawerEl.renderContents === 'function') {
              try { drawerEl.renderContents(cart); } catch (e) { console.warn('lookbook: drawer.renderContents failed', e); }
            }
          } catch(e){ console.warn(e); }

          // 3) Fallback: re-render cart-drawer and cart-icon-bubble sections by fetching them from server and replacing HTML (section rendering fallback)
          // This approach refreshes Dawn's cart drawer & icon if renderContents isn't available. (common fallback approach). :contentReference[oaicite:2]{index=2}
          try {
            // cart-drawer
            fetch(window.location.pathname + '?section_id=cart-drawer').then(function(res){ return res.text(); }).then(function(html){
              var parser = new DOMParser(); var doc = parser.parseFromString(html, 'text/html');
              var newDrawer = doc.getElementById('cart-drawer');
              var oldDrawer = document.getElementById('cart-drawer');
              if(newDrawer && oldDrawer) oldDrawer.innerHTML = newDrawer.innerHTML;
            }).catch(function(e){ /* ignore */ });

            // cart icon bubble (id commonly used: cart-icon-bubble or cart-icon)
            fetch(window.location.pathname + '?section_id=cart-icon-bubble').then(function(res){ return res.text(); }).then(function(html){
              var parser = new DOMParser(); var doc = parser.parseFromString(html, 'text/html');
              var newBubble = doc.getElementById('cart-icon-bubble');
              var oldBubble = document.getElementById('cart-icon-bubble');
              if(newBubble && oldBubble) oldBubble.innerHTML = newBubble.innerHTML;
            }).catch(function(e){ /* ignore */ });

          } catch(e){ console.warn('lookbook: cart section refresh failed', e); }

          // 4) Optionally open the drawer if theme supports it: try play nicely with Dawn (open if method exists)
          try {
            var noti = document.querySelector('cart-notification') || document.querySelector('cart-drawer') || document.getElementById('cart-drawer');
            if(noti && typeof noti.open === 'function') {
              try { noti.open(); } catch(e){ /* ignore */ }
            } else if(window.CartNotification && typeof window.CartNotification === 'function'){
              // nothing specific; other patterns exist
            }
          } catch(e){ /* ignore */ }

          // UX
          btn.textContent = 'Added';
          setTimeout(function(){ btn.disabled = false; btn.textContent = oldTxt; }, 1000);
        }).catch(function(err){
          console.error('Lookbook add-to-cart error', err);
          window.alert((err && err.description) ? err.description : 'Could not add to cart.');
          btn.disabled = false; btn.textContent = oldTxt;
        });
      });

      return card;
    }

    /* fetch product by handle when only handle provided */
    function fetchProductByHandle(handle){
      if(!handle) return Promise.resolve(null);
      return fetch('/products/' + encodeURIComponent(handle) + '.js', { credentials: 'same-origin' })
        .then(function(r){ if(!r.ok) throw new Error('Product fetch failed'); return r.json(); })
        .catch(function(e){ console.warn('lookbook: product fetch failed', handle, e); return null; });
    }

    /* Initialize section instance */
    function initSection(sectionEl){
      if(!sectionEl) return;
      var listInner = sectionEl.querySelector('.lookbook-list-inner');
      var jsonNodes = Array.from(sectionEl.querySelectorAll('.lb-product-json'));
      if(!jsonNodes.length){
        listInner.innerHTML = '<div style="color:#999">No products selected. Add product blocks in the theme editor.</div>'; return;
      }

      var promises = jsonNodes.map(function(node){
        var txt = node.textContent.trim();
        if(!txt) return Promise.resolve(null);
        try {
          var parsed = JSON.parse(txt);
          if(parsed && parsed.variants && parsed.variants.length) return Promise.resolve(normalizeProduct(parsed));
          if(parsed && parsed.handle) return fetchProductByHandle(parsed.handle).then(function(remote){ return remote ? normalizeProduct(remote) : null; });
          // fallback: treat text as handle
          return fetchProductByHandle(txt).then(function(remote){ return remote ? normalizeProduct(remote) : null; });
        } catch(e){
          // invalid JSON: treat as handle
          return fetchProductByHandle(txt).then(function(remote){ return remote ? normalizeProduct(remote) : null; });
        }
      });

      Promise.all(promises).then(function(arr){
        var products = arr.filter(Boolean);
        if(!products.length){
          listInner.innerHTML = '<div style="color:#999">Selected products could not be loaded. Check handles or availability.</div>'; return;
        }
        listInner.innerHTML = '';
        products.forEach(function(p){ var card = buildCard(p); listInner.appendChild(card); });
      }).catch(function(err){
        console.error('Lookbook: error building list', err);
        listInner.innerHTML = '<div style="color:#c00">Error loading lookbook products.</div>';
      });
    }

    /* DOM ready */
    function onReady(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

    onReady(function(){
      // initialize only this section instance if possible
      var sectionSelector = '.lookbook[data-section-id="{{ section.id }}"]';
      var sectionEl = document.querySelector(sectionSelector) || document.querySelector('.lookbook');
      if(sectionEl) initSection(sectionEl);
    });

  })();