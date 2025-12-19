/*
Neatools: a nano JavaScript framework made just for Neat Bookmarks and nothing else.
Modernized for ES6+ and Manifest V3.
*/

const $ = (id) => document.getElementById(id);

const Utils = {
    // String helpers
    widont: (str) => str.replace(/\s([^\s]+)$/i, '&nbsp;$1'),
    toInt: (str, base) => parseInt(str, base || 10),
    htmlspecialchars: (str) => str.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    escapeRegExp: (str) => str.replace(/([-.*+?^${}()|[\/\\])/g, '\\$1'),

    // Array helpers
    clean: (arr) => arr.filter(obj => obj != undefined),
    getLast: (arr) => (arr.length) ? arr[arr.length - 1] : null,
    
    // Element helpers
    inject: (el, target, where = 'bottom') => {
        const inserters = {
            before: (context, element) => element.parentNode?.insertBefore(context, element),
            after: (context, element) => element.parentNode?.insertBefore(context, element.nextSibling),
            bottom: (context, element) => element.appendChild(context),
            top: (context, element) => element.insertBefore(context, element.firstChild)
        };
        inserters[where](el, target);
        return el;
    },
    
    getSiblings: (el) => {
        return Array.from(el.parentNode.children).filter(child => child !== el);
    }
};
