(async function() {
    // Load settings first
    const settings = await chrome.storage.local.get(null);
    const setSetting = (key, value) => {
        if (value === null || value === undefined) {
            delete settings[key];
            chrome.storage.local.remove([key]);
        } else {
            settings[key] = value;
            chrome.storage.local.set({ [key]: value });
        }
    };

    const init = () => {
        if (settings.popupHeight) document.body.style.height = settings.popupHeight + 'px';
        if (settings.popupWidth) document.body.style.width = settings.popupWidth + 'px';
    };

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    const body = document.body;
    const _m = chrome.i18n.getMessage;

    // Error alert
    const AlertDialog = {
        open: function(dialog){
            if (!dialog) return;
            $('alert-dialog-text').innerHTML = dialog;
            body.classList.add('needAlert');
        },
        close: function(){
            body.classList.remove('needAlert');
        }
    };
    // popdown toast when an error occurs
    window.addEventListener('error', function(){
        AlertDialog.open('<strong>' + _m('errorOccured') + '</strong><br>' + _m('reportedToDeveloper'));
    }, false);

    // Platform detection
    const os = (navigator.userAgent.toLowerCase().match(/mac|win|linux/i) || ['other'])[0];
    body.classList.add(os);

    // Some i18n
    $('search-input').placeholder = _m('searchBookmarks');
    $('edit-dialog-name').placeholder = _m('name');
    $('edit-dialog-url').placeholder = _m('url');
    
    const i18nMap = {
        'bookmark-new-tab': 'openNewTab',
        'bookmark-new-window': 'openNewWindow',
        'bookmark-new-incognito-window': 'openIncognitoWindow',
        'bookmark-edit': 'edit',
        'bookmark-delete': 'delete',
        'folder-window': 'openBookmarks',
        'folder-new-window': 'openBookmarksNewWindow',
        'folder-new-incognito-window': 'openBookmarksIncognitoWindow',
        'folder-edit': 'edit',
        'folder-delete': 'deleteEllipsis',
        'edit-dialog-button': 'save'
    };
    
    for (const [id, msg] of Object.entries(i18nMap)) {
        const el = $(id);
        if (el) el.textContent = _m(msg);
    }

    // RTL indicator
    const rtl = (window.getComputedStyle(body).direction == 'rtl');
    if (rtl) body.classList.add('rtl');

    // Init some variables
    // opens is a list of open folder IDs
    let opens = settings.opens ? JSON.parse(settings.opens) : [];
    const rememberState = !settings.dontRememberState;
    const httpsPattern = /^https?:\/\//i;

    // Adaptive bookmark tooltips
    const adaptBookmarkTooltips = function(){
        const bookmarks = document.querySelectorAll('li.child a');
        for (let i = 0, l = bookmarks.length; i < l; i++){
            const bookmark = bookmarks[i];
            if (bookmark.classList.contains('titled')){
                if (bookmark.scrollWidth <= bookmark.offsetWidth){
                    bookmark.title = bookmark.href;
                    bookmark.classList.remove('titled');
                }
            } else if (bookmark.scrollWidth > bookmark.offsetWidth){
                const text = bookmark.querySelector('i').textContent;
                const title = bookmark.title;
                if (text != title){
                    bookmark.title = text + '\n' + title;
                    bookmark.classList.add('titled');
                }
            }
        }
    };

    const generateBookmarkHTML = function(title, url, extras){
        if (!extras) extras = '';
        const u = Utils.htmlspecialchars(url);
        // Modern MV3 Favicon URL
        let favicon = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=16');
        let tooltipURL = url;
        if (/^javascript:/i.test(url)){
            if (url.length > 140) tooltipURL = url.slice(0, 140) + '...';
            favicon = 'document-code.png';
        }
        tooltipURL = Utils.htmlspecialchars(tooltipURL);
        const name = Utils.htmlspecialchars(title) || (httpsPattern.test(url) ? url.replace(httpsPattern, '') : _m('noTitle'));
        const href = (/^javascript:/i.test(url)) ? '#' : u;
        return '<a href="' + href + '"' + ' title="' + tooltipURL + '" tabindex="0" ' + extras + '>' + 
            '<img src="' + favicon + '" width="16" height="16" alt=""><i>' + name + '</i></a>';
    };

    const generateHTML = function(data, level){
        if (!level) level = 0;
        const paddingStart = 14 * level;
        const group = (level == 0) ? 'tree' : 'group';
        let html = '<ul role="' + group + '" data-level="' + level + '">';

        for (let i = 0, l = data.length; i < l; i++){
            const d = data[i];
            const children = d.children;
            const title = Utils.htmlspecialchars(d.title);
            const url = d.url;
            const id = d.id;
            const parentID = d.parentId;
            const idHTML = id ? ' id="neat-tree-item-' + id + '"': '';
            const isFolder = d.dateGroupModified || children || typeof url == 'undefined';
            if (isFolder){
                let isOpen = false;
                let open = '';
                if (rememberState){
                    isOpen = opens.includes(id);
                    if (isOpen) open = ' open';
                }
                html += '<li class="parent' + open + '"' + idHTML + ' role="treeitem" aria-expanded="' + isOpen + '" data-parentid="' + parentID + '">' + 
                    '<span tabindex="0" style="padding-inline-start: ' + paddingStart + 'px"><b class="twisty"></b>' + 
                    '<img src="folder.png" width="16" height="16" alt=""><i>' + (title || _m('noTitle')) + '</i>' +
                    '<button class="add-bookmark-btn" title="' + _m('addBookmark') + '" data-id="' + id + '">+</button></span>';
                if (isOpen){
                    if (children){
                        html += generateHTML(children, level + 1);
                    } else {
                        (function(_id){
                            chrome.bookmarks.getChildren(_id).then(function(children){
                                const html = generateHTML(children, level + 1);
                                const div = document.createElement('div');
                                div.innerHTML = html;
                                const ul = div.querySelector('ul');
                                Utils.inject(ul, $('neat-tree-item-' + _id));
                                div.remove();
                            }).catch(console.error);
                        })(_id);
                    }
                }
            } else {
                html += '<li class="child"' + idHTML + ' role="treeitem" data-parentid="' + parentID + '">' + 
                    generateBookmarkHTML(title, url, 'style="padding-inline-start: ' + paddingStart + 'px"');
            }
            html += '</li>';
        }
        html += '</ul>';
        return html;
    };

    const $tree = $('tree');
    chrome.bookmarks.getTree().then(function(tree){
        const html = generateHTML(tree[0].children);
        $tree.innerHTML = html;

        // recall scroll position (from top of popup) when tree opened
        if (rememberState) $tree.scrollTop = settings.scrollTop || 0;

        const focusID = settings.focusID;
        if (typeof focusID != 'undefined' && focusID != null){
            const focusEl = $('neat-tree-item-' + focusID);
            if (focusEl){
                const oriOverflow = $tree.style.overflow;
                $tree.style.overflow = 'hidden';
                focusEl.style.width = '100%';
                focusEl.firstElementChild.classList.add('focus');
                setTimeout(function(){
                    $tree.style.overflow = oriOverflow;
                }, 1);
                setTimeout(function(){
                    setSetting('focusID', null);
                }, 4000);
            }
        }

        setTimeout(adaptBookmarkTooltips, 100);
    }).catch(console.error);

    // Events for the tree
    $tree.addEventListener('scroll', function(){
        setSetting('scrollTop', $tree.scrollTop); // store scroll position at each scroll event
    });
    $tree.addEventListener('focus', function(e){
        const el = e.target;
        const tagName = el.tagName;
        const focusEl = $tree.querySelector('.focus');
        if (focusEl) focusEl.classList.remove('focus');
        if (tagName == 'A' || tagName == 'SPAN'){
            const id = el.parentNode.id.replace('neat-tree-item-', '');
            setSetting('focusID', id);
        } else {
            setSetting('focusID', null);
        }
    }, true);
    
    const closeUnusedFolders = settings.closeUnusedFolders;
    $tree.addEventListener('click', function(e){
        if (e.button != 0) return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName != 'SPAN') return;
        if (e.shiftKey || e.ctrlKey) return;
        const parent = el.parentNode;
        parent.classList.toggle('open');
        const expanded = parent.classList.contains('open');
        parent.setAttribute('aria-expanded', expanded);
        const children = parent.querySelector('ul');
        if (!children){
            const id = parent.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id).then(function(children){
                const html = generateHTML(children, parseInt(parent.parentNode.dataset.level) + 1);
                const div = document.createElement('div');
                div.innerHTML = html;
                const ul = div.querySelector('ul');
                Utils.inject(ul, parent);
                div.remove();
                setTimeout(adaptBookmarkTooltips, 100);
            });
        }
        if (closeUnusedFolders && expanded){
            const siblings = Utils.getSiblings(parent);
            for (let i = 0, l = siblings.length; i < l; i++){
                const li = siblings[i];
                if (li.classList.contains('parent')){
                    li.classList.remove('open');
                    li.setAttribute('aria-expanded', false);
                }
            }
        }
        let openNodes = $tree.querySelectorAll('li.open');
        opens = Array.from(openNodes).map(function(li){
            return li.id.replace('neat-tree-item-', '');
        });
        setSetting('opens', JSON.stringify(opens));
    });

    $tree.addEventListener('click', function(e) {
        if (!e.target.classList.contains('add-bookmark-btn')) return;
        e.preventDefault();
        e.stopPropagation();
        const btn = e.target;
        const folderId = btn.dataset.id;
        const li = btn.closest('li.parent');

        chrome.tabs.query({active: true, currentWindow: true}).then(function(tabs){
             const tab = tabs[0];
             chrome.bookmarks.create({
                 parentId: folderId,
                 title: tab.title,
                 url: tab.url
             }).then(function(createdNode) {
                 // Update UI if folder is open
                 if (li && li.classList.contains('open')) {
                     const ul = li.querySelector('ul');
                     if (ul) {
                         const level = parseInt(ul.dataset.level);
                         const paddingStart = 14 * level;
                         const newLi = document.createElement('li');
                         newLi.className = 'child';
                         newLi.id = 'neat-tree-item-' + createdNode.id;
                         newLi.setAttribute('role', 'treeitem');
                         newLi.dataset.parentid = folderId;
                         newLi.innerHTML = generateBookmarkHTML(createdNode.title, createdNode.url, 'style="padding-inline-start: ' + paddingStart + 'px"');
                         ul.appendChild(newLi);
                     }
                 }

                 btn.textContent = '✓';
                 setTimeout(() => {
                     btn.textContent = '+';
                 }, 1500);
             });
        });
    });
    
    // Force middle clicks to trigger the focus event
    $tree.addEventListener('mouseup', function(e){
        if (e.button != 1) return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName != 'A' && tagName != 'SPAN') return;
        el.focus();
    });

    // Search
    const $results = $('results');
    let searchMode = false;
    const searchInput = $('search-input');
    let prevValue = '';

    const search = function(){
        const value = searchInput.value.trim();
        setSetting('searchQuery', value);
        if (value == ''){
            prevValue = '';
            searchMode = false;
            $tree.style.display = 'block';
            $results.style.display = 'none';
            return;
        }
        if (value == prevValue) return;
        prevValue = value;
        searchMode = true;
        chrome.bookmarks.search(value).then(function(results){
            const v = value.toLowerCase();
            let vPattern = new RegExp('^' + Utils.escapeRegExp(value).replace(/\s+/g, '.*'), 'ig');
            if (results.length > 1){
                results.sort(function(a, b){
                    const aTitle = a.title;
                    const bTitle = b.title;
                    let aIndexTitle = aTitle.toLowerCase().indexOf(v);
                    let bIndexTitle = bTitle.toLowerCase().indexOf(v);
                    if (aIndexTitle >= 0 || bIndexTitle >= 0){
                        if (aIndexTitle < 0) aIndexTitle = Infinity;
                        if (bIndexTitle < 0) bIndexTitle = Infinity;
                        return aIndexTitle - bIndexTitle;
                    }
                    const aTestTitle = vPattern.test(aTitle);
                    const bTestTitle = vPattern.test(bTitle);
                    if (aTestTitle && !bTestTitle) return -1;
                    if (!aTestTitle && bTestTitle) return 1;
                    return b.dateAdded - a.dateAdded;
                });
                results = results.slice(0, 100); // 100 is enough
            }
            let html = '<ul role="list">';
            for (let i = 0, l = results.length; i < l; i++){
                const result = results[i];
                const id = result.id;
                html += '<li data-parentid="' + result.parentId + '" id="results-item-' + id + '" role="listitem">' + 
                    generateBookmarkHTML(result.title, result.url);
            }
            html += '</ul>';
            $tree.style.display = 'none';
            $results.innerHTML = html;
            $results.style.display = 'block';

            const lis = $results.querySelectorAll('li');
            Array.from(lis).forEach(function(li){
                const parentId = li.dataset.parentid;
                chrome.bookmarks.get(parentId).then(function(node){
                    if (!node || !node.length) return;
                    const a = li.querySelector('a');
                    a.title = _m('parentFolder', node[0].title) + '\n' + a.title;
                });
            });

            results = null;
            vPattern = null;
        }).catch(console.error);
    };
    searchInput.addEventListener('input', search);

    searchInput.addEventListener('keydown', function(e){
        const code = e.code;
        const focusID = settings.focusID;
        if (code === 'ArrowDown' && searchInput.value.length == searchInput.selectionEnd){ // down
            e.preventDefault();
            if (searchMode){
                $results.querySelector('ul>li:first-child a').focus();
            } else {
                $tree.querySelector('ul>li:first-child').querySelector('span, a').focus();
            }
        } else if (code === 'Enter' && searchInput.value.length){ // enter
            const item = $results.querySelector('ul>li:first-child a');
            item.focus();
            setTimeout(function(){
                const event = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                item.dispatchEvent(event);
            }, 30);
        } else if (code === 'Tab' && !searchMode){ // tab
            if (typeof focusID != 'undefined' && focusID != null){
                const focusEl = $('neat-tree-item-' + focusID);
                if (focusEl){
                    e.preventDefault();
                    focusEl.firstElementChild.focus();
                }
            } else {
                const bound = $tree.scrollTop;
                const items = $tree.querySelectorAll('a, span');
                const firstItem = Array.from(items).filter(function(item){
                    return !!item.parentElement.offsetHeight && ((item.offsetTop + item.offsetHeight) > bound);
                })[0];
                if (firstItem) firstItem.focus();
            }
        // Pressing esc shouldn't close the popup when search field has value
        } else if (code === 'Escape' && searchInput.value){ // esc
            e.preventDefault();
            searchInput.value = '';
            search();
        }
    });

    searchInput.addEventListener('focus', function(){
        body.classList.add('searchFocus');
    });
    searchInput.addEventListener('blur', function(){
        body.classList.remove('searchFocus');
    });

    // Saved search query
    if (rememberState && settings.searchQuery){
        searchInput.value = settings.searchQuery;
        search();
        searchInput.select();
        searchInput.scrollLeft = 0;
    }

    // Popup auto-height
    const resetHeight = function(){
        const zoomLevel = settings.zoom ? Utils.toInt(settings.zoom) / 100 : 1;
        setTimeout(function(){
            const neatTree = $tree.firstElementChild;
            if (neatTree){
                const fullHeight = (neatTree.offsetHeight + $tree.offsetTop + 16) * zoomLevel;
                // Slide up faster than down
                body.style.transitionDuration = (fullHeight < window.innerHeight) ? '.3s' : '.1s';
                const maxHeight = screen.height - window.screenY - 50;
                const height = Math.max(200, Math.min(fullHeight, maxHeight));
                body.style.height = height + 'px';
                setSetting('popupHeight', height);
            }
        }, 100);
    };
    if (!searchMode) resetHeight();
    $tree.addEventListener('click', resetHeight);
    $tree.addEventListener('keyup', resetHeight);

    // Confirm dialog event listeners
    $('confirm-dialog-button-1').addEventListener('click', function(){
        ConfirmDialog.fn1();
        ConfirmDialog.close();
    }, false);

    $('confirm-dialog-button-2').addEventListener('click', function(){
        ConfirmDialog.fn2();
        ConfirmDialog.close();
    }, false);

    // Confirm dialog
    const ConfirmDialog = {
        open: function(opts){
            if (!opts) return;
            $('confirm-dialog-text').innerHTML = Utils.widont(opts.dialog);
            $('confirm-dialog-button-1').innerHTML = opts.button1;
            $('confirm-dialog-button-2').innerHTML = opts.button2;
            if (opts.fn1) ConfirmDialog.fn1 = opts.fn1;
            if (opts.fn2) ConfirmDialog.fn2 = opts.fn2;
            $('confirm-dialog-button-' + (opts.focusButton || 1)).focus();
            document.body.classList.add('needConfirm');
        },
        close: function(){
            document.body.classList.remove('needConfirm');
        },
        fn1: function(){},
        fn2: function(){}
    };

    // Edit dialog event listener
    $('edit-dialog').addEventListener('submit', function(){
        EditDialog.close();
        return false;
    }, false);

    // Edit dialog
    const EditDialog = window.EditDialog = {
        open: function(opts){
            if (!opts) return;
            $('edit-dialog-text').innerHTML = Utils.widont(opts.dialog);
            if (opts.fn) EditDialog.fn = opts.fn;
            const type = opts.type || 'bookmark';
            const name = $('edit-dialog-name');
            name.value = opts.name;
            name.focus();
            name.select();
            name.scrollLeft = 0; // very delicate, show first few words instead of last
            const url = $('edit-dialog-url');
            if (type == 'bookmark'){
                url.style.display = '';
                url.disabled = false;
                url.value = opts.url;
            } else {
                url.style.display = 'none';
                url.disabled = true;
                url.value = '';
            }
            body.classList.add('needEdit');
        },
        close: function(){
            const urlInput = $('edit-dialog-url');
            let url = urlInput.value;
            if (!urlInput.validity.valid){
                urlInput.value = 'http://' + url;
                if (!urlInput.validity.valid) url = ''; // if still invalid, forget it.
                url = 'http://' + url;
            }
            EditDialog.fn($('edit-dialog-name').value, url);
            body.classList.remove('needEdit');
        },
        fn: function(){}
    };

    // Bookmark handling
    const dontConfirmOpenFolder = !!settings.dontConfirmOpenFolder;
    const bookmarkClickStayOpen = !!settings.bookmarkClickStayOpen;
    const openBookmarksLimit = 10;
    const actions = {
        openBookmark: function(url){
            chrome.tabs.query({active: true, currentWindow: true}).then(function(tabs){
                const tab = tabs[0];
                chrome.tabs.update(tab.id, {
                    url: url
                });
                if (!bookmarkClickStayOpen) setTimeout(window.close, 200);
            });
        },

        openBookmarkNewTab: function(url, selected, blankTabCheck){
            const open = function(){
                chrome.tabs.create({
                    url: url,
                    active: selected
                });
            };
            if (blankTabCheck){
                chrome.tabs.query({active: true, currentWindow: true}).then(function(tabs){
                    const tab = tabs[0];
                    if (/^chrome:\/\/newtab/i.test(tab.url)){
                        chrome.tabs.update(tab.id, {
                            url: url
                        });
                        if (!bookmarkClickStayOpen) setTimeout(window.close, 200);
                    } else {
                        open();
                    }
                });
            } else {
                open();
            }
        },

        openBookmarkNewWindow: function(url, incognito){
            chrome.windows.create({
                url: url,
                incognito: incognito
            });
        },

        openBookmarks: function(urls, selected){
            const urlsLen = urls.length;
            const open = function(){
                chrome.tabs.create({
                    url: urls.shift(),
                    active: selected // first tab will be selected
                });
                for (let i = 0, l = urls.length; i < l; i++){
                    chrome.tabs.create({
                        url: urls[i],
                        active: false
                    });
                }
            };
            if (!dontConfirmOpenFolder && urlsLen > openBookmarksLimit){
                ConfirmDialog.open({
                    dialog: _m('confirmOpenBookmarks', ''+urlsLen),
                    button1: '<strong>' + _m('open') + '</strong>',
                    button2: _m('nope'),
                    fn1: open
                });
            } else {
                open();
            }
        },

        openBookmarksNewWindow: function(urls, incognito){
            const urlsLen = urls.length;
            const open = function(){
                chrome.windows.create({
                    url: urls,
                    incognito: incognito
                });
            };
            if (!dontConfirmOpenFolder && urlsLen > openBookmarksLimit){
                const dialog = incognito ? _m('confirmOpenBookmarksNewIncognitoWindow', ''+urlsLen) : _m('confirmOpenBookmarksNewWindow', ''+urlsLen);
                ConfirmDialog.open({
                    dialog: dialog,
                    button1: '<strong>' + _m('open') + '</strong>',
                    button2: _m('nope'),
                    fn1: open
                });
            } else {
                open();
            }
        },

        editBookmarkFolder: function(id){
            chrome.bookmarks.get(id).then(function(nodeList){
                if (!nodeList.length) return;
                const node = nodeList[0];
                const url = node.url;
                const isBookmark = !!url;
                const type = isBookmark ? 'bookmark' : 'folder';
                const dialog = isBookmark ? _m('editBookmark') : _m('editFolder');
                EditDialog.open({
                    dialog: dialog,
                    type: type,
                    name: node.title,
                    url: url,
                    fn: function(name, url){
                        chrome.bookmarks.update(id, {
                            title: name,
                            url: isBookmark ? url : ''
                        }).then(function(n){
                            const title = n.title;
                            const url = n.url;
                            let li = $('neat-tree-item-' + id);
                            if (li){
                                if (isBookmark){
                                    const css = li.querySelector('a').style.cssText;
                                    li.innerHTML = generateBookmarkHTML(title, url, 'style="' + css + '"');
                                } else {
                                    const i = li.querySelector('i');
                                    const name = title || (httpsPattern.test(url) ? url.replace(httpsPattern, '') : _m('noTitle'));
                                    i.textContent = name;
                                }
                            }
                            if (searchMode){
                                li = $('results-item-' + id);
                                li.innerHTML = generateBookmarkHTML(title, url);
                            }
                            li.firstElementChild.focus();
                        });
                    }
                });
            });
        },

        deleteBookmark: function(id){
            const li1 = $('neat-tree-item-' + id);
            const li2 = $('results-item-' + id);
            chrome.bookmarks.remove(id).then(function(){
                if (li1){
                    const nearLi1 = li1.nextElementSibling || li1.previousElementSibling;
                    li1.remove();
                    if (!searchMode && nearLi1) nearLi1.querySelector('a, span').focus();
                }
                if (li2){
                    const nearLi2 = li2.nextElementSibling || li2.previousElementSibling;
                    li2.remove();
                    if (searchMode && nearLi2) nearLi2.querySelector('a, span').focus();
                }
            });
        },

        deleteBookmarks: function(id, bookmarkCount, folderCount){
            const li = $('neat-tree-item-' + id);
            const item = li.querySelector('span');
            if (bookmarkCount || folderCount){
                let dialog = '';
                const folderName = '<cite>' + item.textContent.trim() + '</cite>';
                if (bookmarkCount && folderCount){
                    dialog = _m('confirmDeleteFolderSubfoldersBookmarks', [folderName, folderCount, bookmarkCount]);
                } else if (bookmarkCount){
                    dialog = _m('confirmDeleteFolderBookmarks', [folderName, bookmarkCount]);
                } else {
                    dialog = _m('confirmDeleteFolderSubfolders', [folderName, folderCount]);
                }
                ConfirmDialog.open({
                    dialog: dialog,
                    button1: '<strong>' + _m('delete') + '</strong>',
                    button2: _m('nope'),
                    fn1: function(){
                        chrome.bookmarks.removeTree(id).then(function(){
                            li.remove();
                        });
                        const nearLi = li.nextElementSibling || li.previousElementSibling;
                        if (nearLi) nearLi.querySelector('a, span').focus();
                    },
                    fn2: function(){
                        li.querySelector('a, span').focus();
                    }
                });
            } else {
                chrome.bookmarks.removeTree(id).then(function(){
                    li.remove();
                });
                const nearLi = li.nextElementSibling || li.previousElementSibling;
                if (nearLi) nearLi.querySelector('a, span').focus();
            }
        }
    };

    const middleClickBgTab = !!settings.middleClickBgTab;
    const leftClickNewTab = !!settings.leftClickNewTab;
    let noOpenBookmark = false;
    const bookmarkHandler = function(e){
        e.preventDefault();
        if (e.button != 0) return; // force left-click
        if (noOpenBookmark){ // flag that disables opening bookmark
            noOpenBookmark = false;
            return;
        }
        const el = e.target;
        const ctrlMeta = (e.ctrlKey || e.metaKey);
        const shift = e.shiftKey;
        if (el.tagName == 'A'){
            const url = el.href;
            if (ctrlMeta){ // ctrl/meta click
                actions.openBookmarkNewTab(url, middleClickBgTab ? shift : !shift);
            } else { // click
                if (shift){
                    actions.openBookmarkNewWindow(url);
                } else {
                    leftClickNewTab ? actions.openBookmarkNewTab(url, true, true) : actions.openBookmark(url);
                }
            }
        } else if (el.tagName == 'SPAN'){
            const li = el.parentNode;
            const id = li.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id).then(function(children){
                const urls = Utils.clean(Array.from(children).map(function(c){
                    return c.url;
                }));
                const urlsLen = urls.length;
                if (!urlsLen) return;
                if (ctrlMeta){ // ctrl/meta click
                    actions.openBookmarks(urls, middleClickBgTab ? shift : !shift);
                } else if (shift){ // shift click
                    actions.openBookmarksNewWindow(urls);
                }
            });
        }
    };
    $tree.addEventListener('click', bookmarkHandler);
    $results.addEventListener('click', bookmarkHandler);
    const bookmarkHandlerMiddle = function(e){
        if (e.button != 1) return; // force middle-click
        e.preventDefault();
        const event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            ctrlKey: true,
            metaKey: true,
            shiftKey: e.shiftKey
        });
        e.target.dispatchEvent(event);
    };
    $tree.addEventListener('auxclick', bookmarkHandlerMiddle);
    $results.addEventListener('auxclick', bookmarkHandlerMiddle);

    // Disable Chrome auto-scroll feature
    window.addEventListener('mousedown', function(e){
        if (e.button == 1) e.preventDefault();
    });

    // Context menu
    const $bookmarkContextMenu = $('bookmark-context-menu');
    const $folderContextMenu = $('folder-context-menu');

    const clearMenu = function(e){
        currentContext = null;
        const active = body.querySelector('.active');
        if (active){
            active.classList.remove('active');
            // This is kinda hacky. Oh well.
            if (e){
                const el = e.target;
                if (el == $tree || el == $results) active.focus();
            }
        }
        $bookmarkContextMenu.style.left = '-999px';
        $bookmarkContextMenu.style.opacity = 0;
        $folderContextMenu.style.left = '-999px';
        $folderContextMenu.style.opacity = 0;
    };

    body.addEventListener('click', clearMenu);
    $tree.addEventListener('scroll', clearMenu);
    $results.addEventListener('scroll', clearMenu);
    $tree.addEventListener('focus', clearMenu, true);
    $results.addEventListener('focus', clearMenu, true);

    let currentContext = null;
    let macCloseContextMenu = false;
    body.addEventListener('contextmenu', function(e){
        e.preventDefault();
        clearMenu();
        if (os == 'mac'){
            macCloseContextMenu = false;
            setTimeout(function(){ macCloseContextMenu = true; }, 500);
        }
        const el = e.target;
        if (el.tagName == 'A'){
            currentContext = el;
            const active = body.querySelector('.active');
            if (active) active.classList.remove('active');
            el.classList.add('active');
            const bookmarkMenuWidth = $bookmarkContextMenu.offsetWidth;
            const bookmarkMenuHeight = $bookmarkContextMenu.offsetHeight;
            const pageX = rtl ? Math.max(0, e.pageX - bookmarkMenuWidth) : Math.min(e.pageX, body.offsetWidth - bookmarkMenuWidth);
            let pageY = e.pageY;
            const boundY = window.innerHeight - bookmarkMenuHeight;
            if (pageY > boundY) pageY -= bookmarkMenuHeight;
            if (pageY < 0) pageY = boundY;
            pageY = Math.max(0, pageY);
            $bookmarkContextMenu.style.left = pageX + 'px';
            $bookmarkContextMenu.style.top = pageY + 'px';
            $bookmarkContextMenu.style.opacity = 1;
            $bookmarkContextMenu.focus();
        } else if (el.tagName == 'SPAN'){
            currentContext = el;
            const active = body.querySelector('.active');
            if (active) active.classList.remove('active');
            el.classList.add('active');
            if (el.parentNode.dataset.parentid == '0'){
                $folderContextMenu.classList.add('hide-editables');
            } else {
                $folderContextMenu.classList.remove('hide-editables');
            }
            const folderMenuWidth = $folderContextMenu.offsetWidth;
            const folderMenuHeight = $folderContextMenu.offsetHeight;
            const pageX = rtl ? Math.max(0, e.pageX - folderMenuWidth) : Math.min(e.pageX, body.offsetWidth - folderMenuWidth);
            let pageY = e.pageY;
            const boundY = window.innerHeight - folderMenuHeight;
            if (pageY > boundY) pageY -= folderMenuHeight;
            if (pageY < 0) pageY = boundY;
            $folderContextMenu.style.left = pageX + 'px';
            $folderContextMenu.style.top = pageY + 'px';
            $folderContextMenu.style.opacity = 1;
            $folderContextMenu.focus();
        }
    });
    // on Mac, holding down right-click for a period of time closes the context menu
    // Not a complete implementation, but it works :)
    if (os == 'mac') body.addEventListener('mouseup', function(e){
        if (e.button == 2 && macCloseContextMenu){
            macCloseContextMenu = false;
            clearMenu();
        }
    });

    const bookmarkContextHandler = function(e){
        e.stopPropagation();
        if (!currentContext) return;
        const el = e.target;
        if (!el.classList.contains('command')) return;
        const url = currentContext.href;
        switch (el.id){
            case 'bookmark-new-tab':
                actions.openBookmarkNewTab(url);
                break;
            case 'bookmark-new-window':
                actions.openBookmarkNewWindow(url);
                break;
            case 'bookmark-new-incognito-window':
                actions.openBookmarkNewWindow(url, true);
                break;
            case 'bookmark-edit':
                const li = currentContext.parentNode;
                const id = li.id.replace(/(neat\-tree|results)\-item\-/, '');
                actions.editBookmarkFolder(id);
                break;
            case 'bookmark-delete':
                const liDel = currentContext.parentNode;
                const idDel = liDel.id.replace(/(neat\-tree|results)\-item\-/, '');
                actions.deleteBookmark(idDel);
                break;
        }
        clearMenu();
    };
    // On Mac, all three mouse clicks work; on Windows, middle-click doesn't work
    $bookmarkContextMenu.addEventListener('mouseup', function(e){
        e.stopPropagation();
        if (e.button == 0 || (os == 'mac' && e.button == 1)) bookmarkContextHandler(e);
    });
    $bookmarkContextMenu.addEventListener('contextmenu', bookmarkContextHandler);
    $bookmarkContextMenu.addEventListener('click', function(e){
        e.stopPropagation();
    });

    const folderContextHandler = function(e){
        if (!currentContext) return;
        const el = e.target;
        if (!el.classList.contains('command')) return;
        const li = currentContext.parentNode;
        const id = li.id.replace('neat-tree-item-', '');
        chrome.bookmarks.getChildren(id).then(function(children){
            const urls = Utils.clean(Array.from(children).map(function(c){
                return c.url;
            }));
            const urlsLen = urls.length;
            const noURLS = !urlsLen;
            switch (el.id){
                case 'folder-window':
                    if (noURLS) return;
                    actions.openBookmarks(urls);
                    break;
                case 'folder-new-window':
                    if (noURLS) return;
                    actions.openBookmarksNewWindow(urls);
                    break;
                case 'folder-new-incognito-window':
                    if (noURLS) return;
                    actions.openBookmarksNewWindow(urls, true);
                    break;
                case 'folder-edit':
                    actions.editBookmarkFolder(id);
                    break;
                case 'folder-delete':
                    actions.deleteBookmarks(id, urlsLen, children.length-urlsLen);
                    break;
            }
        });
        clearMenu();
    };
    $folderContextMenu.addEventListener('mouseup', function(e){
        e.stopPropagation();
        if (e.button == 0 || (os == 'mac' && e.button == 1)) folderContextHandler(e);
    });
    $folderContextMenu.addEventListener('contextmenu', folderContextHandler);
    $folderContextMenu.addEventListener('click', function(e){
        e.stopPropagation();
    });

    // Keyboard navigation
    let keyBuffer = '';
    let keyBufferTimer;
    const treeKeyDown = function(e){
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName)) item = $tree.querySelector('.focus') || $tree.querySelector('li:first-child>span');
        let li = item.parentNode;
        let code = e.code;
        const metaKey = e.metaKey;
        if (code === 'ArrowDown' && metaKey) code = 'End'; // cmd + down (Mac)
        if (code === 'ArrowUp' && metaKey) code = 'Home'; // cmd + up (Mac)
        
        switch (code){
            case 'ArrowDown': // down
                e.preventDefault();
                var liChild = li.querySelector('ul>li:first-child');
                if (li.classList.contains('open') && liChild){
                    liChild.querySelector('a, span').focus();
                } else {
                    let nextLi = li.nextElementSibling;
                    if (nextLi){
                        nextLi.querySelector('a, span').focus();
                    } else {
                        let lastLi = null;
                        do {
                            li = li.parentNode.parentNode;
                            if (li) nextLi = li.nextElementSibling;
                            if (nextLi) lastLi = nextLi.querySelector('a, span');
                            if (lastLi) lastLi.focus(); // down on the last item in tree
                        } while (li && !nextLi);
                    }
                }
                break;
            case 'ArrowUp': // up
                e.preventDefault();
                var prevLi = li.previousElementSibling;
                if (prevLi){
                    while (prevLi.classList.contains('open') && prevLi.querySelector('ul>li:last-child')){
                        const lis = prevLi.querySelectorAll('ul>li:last-child');
                        prevLi = Utils.getLast(Array.from(lis).filter(function(li){
                            return !!li.parentNode.offsetHeight;
                        }));
                    };
                    prevLi.querySelector('a, span').focus();
                } else {
                    const parentPrevLi = li.parentNode.parentNode;
                    if (parentPrevLi && parentPrevLi.tagName == 'LI'){
                        parentPrevLi.querySelector('a, span').focus();
                    } else {
                        searchInput.focus();
                    }
                }
                break;
            case 'ArrowRight': // right (left for RTL)
                e.preventDefault();
                if (li.classList.contains('parent') && ((!rtl && !li.classList.contains('open')) || (rtl && li.classList.contains('open')))){
                    const event = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    li.firstElementChild.dispatchEvent(event);
                } else if (rtl){
                    const parentID = li.dataset.parentid;
                    if (parentID == '0') return;
                    $('neat-tree-item-' + parentID).querySelector('span').focus();
                }
                break;
            case 'ArrowLeft': // left (right for RTL)
                e.preventDefault();
                if (li.classList.contains('parent') && ((!rtl && li.classList.contains('open')) || (rtl && !li.classList.contains('open')))){
                    const event = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    li.firstElementChild.dispatchEvent(event);
                } else if (!rtl){
                    const parentID = li.dataset.parentid;
                    if (parentID == '0') return;
                    $('neat-tree-item-' + parentID).querySelector('span').focus();
                }
                break;
            case 'Space': // space
            case 'Enter': // enter
                e.preventDefault();
                var event = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey
                });
                li.firstElementChild.dispatchEvent(event);
                break;
            case 'End': // end
                if (searchMode){
                    this.querySelector('li:last-child a').focus();
                } else {
                    const lis = this.querySelectorAll('ul>li:last-child');
                    const li = Utils.getLast(Array.from(lis).filter(function(li){
                        return !!li.parentNode.offsetHeight;
                    }));
                    li.querySelector('span, a').focus();
                }
                break;
            case 'Home': // home
                if (searchMode){
                    this.querySelector('ul>li:first-child a').focus();
                } else {
                    this.querySelector('ul>li:first-child').querySelector('span, a').focus();
                }
                break;
            case 'PageDown': // page down
                var self = this;
                var getLastItem = function(){
                    const bound = self.offsetHeight + self.scrollTop;
                    const items = self.querySelectorAll('a, span');
                    return Utils.getLast(Array.from(items).filter(function(item){
                        return !!item.parentElement.offsetHeight && item.offsetTop < bound;
                    }));
                };
                const targetItem = getLastItem();
                if (targetItem != document.activeElement){
                    e.preventDefault();
                    targetItem.focus();
                } else {
                    setTimeout(function(){
                        getLastItem().focus();
                    }, 0);
                }
                break;
            case 'PageUp': // page up
                var self = this;
                var getFirstItem = function(){
                    const bound = self.scrollTop;
                    const items = self.querySelectorAll('a, span');
                    return Array.from(items).filter(function(item){
                        return !!item.parentElement.offsetHeight && ((item.offsetTop + item.offsetHeight) > bound);
                    })[0];
                };
                const firstItem = getFirstItem();
                if (firstItem != document.activeElement){
                    e.preventDefault();
                    firstItem.focus();
                } else {
                    setTimeout(function(){
                        getFirstItem().focus();
                    }, 0);
                }
                break;
            case 'F2': // F2, not for Mac
                if (os == 'mac') break;
                var id = li.id.replace(/(neat\-tree|results)\-item\-/, '');
                actions.editBookmarkFolder(id);
                break;
            case 'Delete': // delete
                break; // don't run 'default'
            default:
                if (e.key.length === 1) {
                    const key = e.key;
                    if (!key) return;
                    if (key != keyBuffer) keyBuffer += key;
                    clearTimeout(keyBufferTimer);
                    keyBufferTimer = setTimeout(function(){ keyBuffer = ''; }, 500);
                    const lis = this.querySelectorAll('ul>li');
                    const items = [];
                    for (let i = 0, l = lis.length; i < l; i++){
                        const li = lis[i];
                        if (li.parentNode.offsetHeight) items.push(li.firstElementChild);
                    }
                    const pattern = new RegExp('^' + Utils.escapeRegExp(keyBuffer), 'i');
                    const batch = [];
                    let startFind = false;
                    let found = false;
                    const activeElement = document.activeElement;
                    for (let i = 0, l = items.length; i < l; i++){
                        const item = items[i];
                        if (item == activeElement){
                            startFind = true;
                        } else if (startFind){
                            if (pattern.test(item.textContent.trim())){
                                found = true;
                                item.focus();
                                break;
                            }
                        } else {
                            batch.push(item);
                        }
                    }
                    if (!found){
                        for (let i = 0, l = batch.length; i < l; i++){
                            const item = batch[i];
                            if (pattern.test(item.textContent.trim())){
                                item.focus();
                                break;
                            }
                        }
                    }
                }
        }
    };
    $tree.addEventListener('keydown', treeKeyDown);
    $results.addEventListener('keydown', treeKeyDown);

    const treeKeyUp = function(e){
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName)) item = $tree.querySelector('.focus') || $tree.querySelector('li:first-child>span');
        const li = item.parentNode;
        switch (e.code){
            case 'Backspace': // backspace
                if (os != 'mac') break; // somehow delete button on mac gives backspace
            case 'Delete': // delete
                e.preventDefault();
                const id = li.id.replace(/(neat\-tree|results)\-item\-/, '');
                if (li.classList.contains('parent')){
                    chrome.bookmarks.getChildren(id).then(function(children){
                        const urlsLen = Utils.clean(Array.from(children).map(function(c){
                            return c.url;
                        })).length;
                        actions.deleteBookmarks(id, urlsLen, children.length-urlsLen);
                    });
                } else {
                    actions.deleteBookmark(id);
                }
                break;
        }
    };
    $tree.addEventListener('keyup', treeKeyUp);
    $results.addEventListener('keyup', treeKeyUp);

    const contextKeyDown = function(e){
        const menu = this;
        const item = document.activeElement;
        const metaKey = e.metaKey;
        switch (e.code){
            case 'ArrowDown': // down
                e.preventDefault();
                if (metaKey){ // cmd + down (Mac)
                    menu.lastElementChild.focus();
                } else {
                    if (item.classList.contains('command')){
                        let nextItem = item.nextElementSibling;
                        if (nextItem && nextItem.tagName == 'HR') nextItem = nextItem.nextElementSibling;
                        if (nextItem){
                            nextItem.focus();
                        } else if (os != 'mac'){
                            menu.firstElementChild.focus();
                        }
                    } else {
                        item.firstElementChild.focus();
                    }
                }
                break;
            case 'ArrowUp': // up
                e.preventDefault();
                if (metaKey){ // cmd + up (Mac)
                    menu.firstElementChild.focus();
                } else {
                    if (item.classList.contains('command')){
                        let prevItem = item.previousElementSibling;
                        if (prevItem && prevItem.tagName == 'HR') prevItem = prevItem.previousElementSibling;
                        if (prevItem){
                            prevItem.focus();
                        } else if (os != 'mac'){
                            menu.lastElementChild.focus();
                        }
                    } else {
                        item.lastElementChild.focus();
                    }
                }
                break;
            case 'Space': // space
                if (os != 'mac') break;
            case 'Enter': // enter
                e.preventDefault();
                var event = new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                item.dispatchEvent(event);
            case 'Escape': // esc
                e.preventDefault();
                const active = body.querySelector('.active');
                if (active) active.classList.remove('active').focus();
                clearMenu();
        }
    };
    $bookmarkContextMenu.addEventListener('keydown', contextKeyDown);
    $folderContextMenu.addEventListener('keydown', contextKeyDown);

    const contextMouseMove = function(e){
        e.target.focus();
    };
    $bookmarkContextMenu.addEventListener('mousemove', contextMouseMove);
    $folderContextMenu.addEventListener('mousemove', contextMouseMove);

    const contextMouseOut = function(){
        if (Utils.toInt(this.style.opacity)) this.focus();
    };
    $bookmarkContextMenu.addEventListener('mouseout', contextMouseOut);
    $folderContextMenu.addEventListener('mouseout', contextMouseOut);

    // Drag and drop
    let draggedBookmark = null;
    let draggedOut = false;
    let canDrop = false;
    let zoomLevel = 1;
    const bookmarkClone = $('bookmark-clone');
    const dropOverlay = $('drop-overlay');
    $tree.addEventListener('mousedown', function(e){
        if (e.button != 0) return;
        const el = e.target;
        const elParent = el.parentNode;
        // can move any bookmarks/folders except the default root folders
        if ((el.tagName == 'A' && elParent.classList.contains('child')) || (el.tagName == 'SPAN' && elParent.classList.contains('parent') && elParent.dataset.parentid != '0')){
            e.preventDefault();
            draggedOut = false;
            draggedBookmark = el;
            if (settings.zoom) zoomLevel = (Utils.toInt(settings.zoom) / 100);
            bookmarkClone.innerHTML = el.innerHTML;
            el.focus();
        }
    });
    let scrollTree, scrollTreeInterval = 100, scrollTreeSpot = 10;
    const stopScrollTree = function(){
        clearInterval(scrollTree);
        scrollTree = null;
    };
    document.addEventListener('mousemove', function(e){
        if (e.button != 0) return;
        if (!draggedBookmark) return;
        e.preventDefault();
        const el = e.target;
        let clientX = e.clientX;
        let clientY = e.clientY + (document.documentElement.scrollTop || document.body.scrollTop);
        if (el == draggedBookmark){
            bookmarkClone.style.left = '-999px';
            dropOverlay.style.left = '-999px';
            canDrop = false;
            return;
        }
        draggedOut = true;
        // if hovering over the dragged element itself or cursor move outside the tree
        const treeTop = $tree.offsetTop, treeBottom = window.innerHeight;
        if (clientX < 0 || clientY < treeTop || clientX > $tree.offsetWidth || clientY > treeBottom){
            bookmarkClone.style.left = '-999px';
            dropOverlay.style.left = '-999px';
            canDrop = false;
        }
        // if hovering over the top or bottom edges of the tree, scroll the tree
        const treeScrollHeight = $tree.scrollHeight, treeOffsetHeight = $tree.offsetHeight;
        if (treeScrollHeight > treeOffsetHeight){ // only scroll when it's scrollable
            const treeScrollTop = $tree.scrollTop;
            if (clientY <= treeTop + scrollTreeSpot){
                if (treeScrollTop == 0){
                    stopScrollTree();
                } else if (!scrollTree) scrollTree = setInterval(function(){
                    $tree.scrollByLines(-1);
                    dropOverlay.style.left = '-999px';
                }, scrollTreeInterval);
            } else if (clientY >= treeBottom - scrollTreeSpot){
                if (treeScrollTop == (treeScrollHeight - treeOffsetHeight)){
                    stopScrollTree();
                } else if (!scrollTree) scrollTree = setInterval(function(){
                    $tree.scrollByLines(1);
                    dropOverlay.style.left = '-999px';
                }, scrollTreeInterval);
            } else {
                stopScrollTree();
            }
        }
        // collapse the folder before moving it
        const draggedBookmarkParent = draggedBookmark.parentNode;
        if (draggedBookmark.tagName == 'SPAN' && draggedBookmarkParent.classList.contains('open')){
            draggedBookmarkParent.classList.remove('open');
            draggedBookmarkParent.setAttribute('aria-expanded', false);
        }
        clientX /= zoomLevel;
        clientY /= zoomLevel;
        if (el.tagName == 'A'){
            canDrop = true;
            bookmarkClone.style.top = clientY + 'px';
            bookmarkClone.style.left = (rtl ? (clientX - bookmarkClone.offsetWidth) : clientX) + 'px';
            const elRect = el.getBoundingClientRect();
            const elRectTop = elRect.top + (document.documentElement.scrollTop || document.body.scrollTop);
            const elRectBottom = elRect.bottom + (document.documentElement.scrollTop || document.body.scrollTop);
            const top = (clientY >= elRectTop + elRect.height / 2) ? elRectBottom : elRectTop;
            dropOverlay.className = 'bookmark';
            dropOverlay.style.top = top + 'px';
            dropOverlay.style.left = rtl ? '0px' : (Utils.toInt(el.style.paddingInlineStart || el.style.webkitPaddingStart) + 16) + 'px';
            dropOverlay.style.width = (Utils.toInt(window.getComputedStyle(el).width) - 12) + 'px';
            dropOverlay.style.height = null;
        } else if (el.tagName == 'SPAN'){
            canDrop = true;
            bookmarkClone.style.top = clientY + 'px';
            bookmarkClone.style.left = clientX + 'px';
            const elRect = el.getBoundingClientRect();
            let top = null;
            const elRectTop = elRect.top + (document.documentElement.scrollTop || document.body.scrollTop);
            const elRectHeight = elRect.height;
            const elRectBottom = elRect.bottom + (document.documentElement.scrollTop || document.body.scrollTop);
            const elParent = el.parentNode;
            if (elParent.dataset.parentid != '0'){
                if (clientY < elRectTop + elRectHeight * .3){
                    top = elRectTop;
                } else if (clientY > (elRectTop + elRectHeight * .7) && !elParent.classList.contains('open')){
                    top = elRectBottom;
                }
            }
            if (top == null){
                dropOverlay.className = 'folder';
                dropOverlay.style.top = elRectTop + 'px';
                dropOverlay.style.left = '0px';
                dropOverlay.style.width = elRect.width + 'px';
                dropOverlay.style.height = elRect.height + 'px';
            } else {
                dropOverlay.className = 'bookmark';
                dropOverlay.style.top = top + 'px';
                dropOverlay.style.left = (Utils.toInt(el.style.paddingInlineStart || el.style.webkitPaddingStart) + 16) + 'px';
                dropOverlay.style.width = (Utils.toInt(window.getComputedStyle(el).width) - 12) + 'px';
                dropOverlay.style.height = null;
            }
        }
    });
    const onDrop = function(){
        draggedBookmark = null;
        bookmarkClone.style.left = '-999px';
        dropOverlay.style.left = '-999px';
        canDrop = false;
    };
    document.addEventListener('mouseup', function(e){
        if (e.button != 0) return;
        if (!draggedBookmark) return;
        stopScrollTree();
        if (!canDrop){
            if (draggedOut) noOpenBookmark = true;
            draggedOut = false;
            onDrop();
            return;
        };
        const el = e.target;
        const elParent = el.parentNode;
        const id = elParent.id.replace('neat-tree-item-', '');
        if (!id){
            onDrop();
            return;
        }
        const draggedBookmarkParent = draggedBookmark.parentNode;
        const draggedID = draggedBookmarkParent.id.replace('neat-tree-item-', '');
        const clientY = (e.clientY + (document.documentElement.scrollTop || document.body.scrollTop)) / zoomLevel;
        if (el.tagName == 'A'){
            const elRect = el.getBoundingClientRect();
            const elRectTop = elRect.top + (document.documentElement.scrollTop || document.body.scrollTop);
            const moveBottom = (clientY >= elRectTop + elRect.height / 2);
            chrome.bookmarks.get(id).then(function(node){
                if (!node || !node.length) return;
                node = node[0];
                let index = node.index;
                const parentId = node.parentId;
                if (draggedID){
                    chrome.bookmarks.move(draggedID, {
                        parentId: parentId,
                        index: moveBottom ? ++index : index
                    }).then(function(){
                        Utils.inject(draggedBookmarkParent, elParent, moveBottom ? 'after' : 'before');
                        draggedBookmark.style.paddingInlineStart = el.style.paddingInlineStart || el.style.webkitPaddingStart;
                        draggedBookmark.focus();
                        onDrop();
                    });
                }
            });
        } else if (el.tagName == 'SPAN'){
            const elRect = el.getBoundingClientRect();
            let move = 0; // 0 = middle, 1 = top, 2 = bottom
            const elRectTop = elRect.top, elRectHeight = elRect.height;
            const elParent = el.parentNode;
            if (elParent.dataset.parentid != '0'){
                if (clientY < elRectTop + elRectHeight * .3){
                    move = 1;
                } else if (clientY > elRectTop + elRectHeight * .7 && !elParent.classList.contains('open')){
                    move = 2;
                }
            }
            if (move > 0){
                const moveBottom = (move == 2);
                chrome.bookmarks.get(id).then(function(node){
                    if (!node || !node.length) return;
                    node = node[0];
                    let index = node.index;
                    const parentId = node.parentId;
                    chrome.bookmarks.move(draggedID, {
                        parentId: parentId,
                        index: moveBottom ? ++index : index
                    }).then(function(){
                        Utils.inject(draggedBookmarkParent, elParent, moveBottom ? 'after' : 'before');
                        draggedBookmark.style.paddingInlineStart = el.style.paddingInlineStart || el.style.webkitPaddingStart;
                        draggedBookmark.focus();
                        onDrop();
                    });
                });
            } else {
                chrome.bookmarks.move(draggedID, {
                    parentId: id
                }).then(function(){
                    const ul = elParent.querySelector('ul');
                    const level = parseInt(elParent.parentNode.dataset.level) + 1;
                    draggedBookmark.style.paddingInlineStart = (14 * level) + 'px';
                    if (ul){
                        Utils.inject(draggedBookmarkParent, ul);
                    } else {
                        draggedBookmarkParent.remove();
                    }
                    el.focus();
                    onDrop();
                });
            }
        } else {
            onDrop();
        }
    });

    // Resizer
    const $resizer = $('resizer');
    let resizerDown = false;
    let bodyWidth, screenX;
    $resizer.addEventListener('mousedown', function(e){
        e.preventDefault();
        e.stopPropagation();
        resizerDown = true;
        bodyWidth = body.offsetWidth;
        screenX = e.screenX;
    });
    document.addEventListener('mousemove', function(e){
        if (!resizerDown) return;
        e.preventDefault();
        const changedWidth = rtl ? (e.screenX - screenX) : (screenX - e.screenX);
        let width = bodyWidth + changedWidth;
        width = Math.min(640, Math.max(320, width));
        body.style.width = width + 'px';
        setSetting('popupWidth', width);
        clearMenu(); // messes the context menu
    });
    document.addEventListener('mouseup', function(e){
        if (!resizerDown) return;
        e.preventDefault();
        resizerDown = false;
        adaptBookmarkTooltips();
    });

    // Closing dialogs on escape
    const closeDialogs = function(){
            if (body.classList.contains('needConfirm')) { ConfirmDialog.fn2(); ConfirmDialog.close(); }
            if (body.classList.contains('needEdit')) EditDialog.close();
            if (body.classList.contains('needAlert')) AlertDialog.close();
    };
    document.addEventListener('keydown', function(e){
        if (e.code === 'Escape' && (body.classList.contains('needConfirm') || body.classList.contains('needEdit') || body.classList.contains('needAlert'))){ // esc
            e.preventDefault();
            closeDialogs();
        } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyF'){ // cmd/ctrl + f
            searchInput.focus();
            searchInput.select();
        }
    });
    $('cover').addEventListener('click', closeDialogs);

    // Make webkit transitions work only after elements are settled down
    setTimeout(function(){
        body.classList.add('transitional');
    }, 10);

    // Zoom
    if (settings.zoom){
        body.dataset.zoom = settings.zoom;
    }
    const zoom = function(val){
        if (draggedBookmark) return; // prevent zooming when drag-n-droppping
        const dataZoom = body.dataset.zoom;
        const currentZoom = dataZoom ? Utils.toInt(dataZoom) : 100;
        if (val == 0){
            delete body.dataset.zoom;
            setSetting('zoom', null);
        } else {
            let z = (val>0) ? currentZoom + 10 : currentZoom - 10;
            z = Math.min(150, Math.max(90, z));
            body.dataset.zoom = z;
            setSetting('zoom', z);
        }
        body.classList.add('dummy');
        body.classList.remove('dummy'); // force redraw
        resetHeight();
    };
    document.addEventListener('wheel', function(e){
        if (!e.metaKey && !e.ctrlKey) return;
        e.preventDefault();
        // deltaY is usually positive for scrolling down, negative for scrolling up
        // zoom expects positive for zoom in (scrolling up)
        zoom(-e.deltaY);
    }, {passive: false});
    document.addEventListener('keydown', function(e){
        if (!e.metaKey && !e.ctrlKey) return;
        switch (e.code){
            case 'Equal': // + (plus)
                e.preventDefault();
                zoom(1);
                break;
            case 'Minus': // - (minus)
                e.preventDefault();
                zoom(-1);
                break;
            case 'Digit0': // 0 (zero)
                e.preventDefault();
                zoom(0);
                break;
        }
    });

    // Fix stupid wrong offset of the page on Mac
    if (os == 'mac'){
        setTimeout(function(){
            const top = document.documentElement.scrollTop || document.body.scrollTop;
            if (top != 0) {
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
            }
        }, 1500);
    }

    if (settings.userstyle){
        const style = document.createElement('style');
        style.textContent = settings.userstyle;
        Utils.inject(style, document.body);
    }

})();

onerror = function(...args){
    chrome.runtime.sendMessage({error: args});
};