/*
 * support.js — minimal client-side runtime for the "x-dc" template exports.
 *
 * Each page ships a template using <sc-for>, <sc-if> and {{ expr }} placeholders
 * plus a <script type="text/x-dc"> defining `class Component extends DCLogic`
 * with a renderVals() method that returns the data. This runtime resolves those
 * placeholders against that data so the page renders real content (and keeps the
 * FAQ accordion interactive via setState re-renders).
 */
(function () {
  'use strict';

  // Resolve a dotted expression ("t.num", "c", "f.toggle") against a scope.
  function evalExpr(expr, scope) {
    expr = String(expr).trim();
    if (expr === 'false') return false;
    if (expr === 'true') return true;
    if (expr === 'null') return null;
    var parts = expr.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }

  // Replace every {{ expr }} occurrence inside a string.
  function interpolate(str, scope) {
    return str.replace(/\{\{([^}]*)\}\}/g, function (_, e) {
      var v = evalExpr(e, scope);
      return v == null ? '' : String(v);
    });
  }

  // Render a template node against a scope, returning an array of real DOM nodes.
  function render(node, scope) {
    if (node.nodeType === Node.TEXT_NODE) {
      return [document.createTextNode(interpolate(node.textContent, scope))];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [node.cloneNode(true)];
    }

    var tag = node.tagName.toLowerCase();

    if (tag === 'sc-for') {
      var listExpr = (node.getAttribute('list') || '').replace(/\{\{|\}\}/g, '').trim();
      var as = node.getAttribute('as') || 'item';
      var list = evalExpr(listExpr, scope) || [];
      var out = [];
      Array.prototype.forEach.call(list, function (item, idx) {
        var childScope = Object.assign({}, scope);
        childScope[as] = item;
        childScope[as + 'Index'] = idx;
        Array.prototype.forEach.call(node.childNodes, function (ch) {
          render(ch, childScope).forEach(function (n) { out.push(n); });
        });
      });
      return out;
    }

    if (tag === 'sc-if') {
      var valExpr = (node.getAttribute('value') || '').replace(/\{\{|\}\}/g, '').trim();
      if (!evalExpr(valExpr, scope)) return [];
      var kept = [];
      Array.prototype.forEach.call(node.childNodes, function (ch) {
        render(ch, scope).forEach(function (n) { kept.push(n); });
      });
      return kept;
    }

    // Ordinary element: rebuild it, resolving attributes and children.
    var el = document.createElement(tag);
    var hoverStyle = null;
    Array.prototype.forEach.call(node.attributes, function (attr) {
      var name = attr.name;
      var val = attr.value;

      if (name === 'style-hover') { hoverStyle = val; return; }

      if (val.indexOf('{{') !== -1) {
        var single = val.trim().match(/^\{\{([^}]*)\}\}$/);
        if (single) {
          var resolved = evalExpr(single[1], scope);
          if (typeof resolved === 'function') {
            // e.g. onClick="{{ f.toggle }}" -> real click listener.
            var evt = name.toLowerCase().indexOf('on') === 0 ? name.slice(2).toLowerCase() : name;
            el.addEventListener(evt, resolved);
            return;
          }
          val = resolved == null ? '' : String(resolved);
        } else {
          val = interpolate(val, scope);
        }
      }
      el.setAttribute(name, val);
    });

    if (hoverStyle) {
      var base = el.getAttribute('style') || '';
      el.addEventListener('mouseenter', function () {
        el.setAttribute('style', base + ';' + hoverStyle);
      });
      el.addEventListener('mouseleave', function () {
        el.setAttribute('style', base);
      });
    }

    Array.prototype.forEach.call(node.childNodes, function (ch) {
      render(ch, scope).forEach(function (n) { el.appendChild(n); });
    });
    return [el];
  }

  function boot() {
    var xdc = document.querySelector('x-dc');
    var scriptEl = document.querySelector('script[type="text/x-dc"]');
    if (!xdc || !scriptEl) return;

    // The visible content root is the first element child of <x-dc> after <helmet>.
    var contentRoot = null;
    Array.prototype.forEach.call(xdc.children, function (c) {
      if (!contentRoot && c.tagName && c.tagName.toLowerCase() !== 'helmet') contentRoot = c;
    });
    if (!contentRoot) return;

    // Keep a pristine copy of the template before we mutate the DOM.
    var template = contentRoot.cloneNode(true);

    // Parse default props from data-props (only the accent default is used).
    var props = {};
    try {
      var raw = scriptEl.getAttribute('data-props');
      if (raw) {
        var spec = JSON.parse(raw);
        Object.keys(spec).forEach(function (k) {
          if (spec[k] && typeof spec[k] === 'object' && 'default' in spec[k]) props[k] = spec[k].default;
        });
      }
    } catch (e) { /* ignore malformed props */ }

    var current = contentRoot;

    function doRender() {
      var vals = inst.renderVals();
      var newRoot = template.cloneNode(false); // keep the root div's own attributes
      Array.prototype.forEach.call(template.childNodes, function (ch) {
        render(ch, vals).forEach(function (n) { newRoot.appendChild(n); });
      });
      current.parentNode.replaceChild(newRoot, current);
      current = newRoot;
      if (typeof inst.componentDidUpdate === 'function') inst.componentDidUpdate();
    }

    function DCLogic() {}
    DCLogic.prototype.setState = function (updater) {
      var partial = typeof updater === 'function' ? updater(this.state) : updater;
      this.state = Object.assign({}, this.state, partial);
      doRender();
    };

    var factory = new Function('DCLogic', scriptEl.textContent + '\n; return Component;');
    var Component = factory(DCLogic);
    var inst = new Component();
    inst.props = props;
    if (inst.state == null) inst.state = {};

    doRender();
    if (typeof inst.componentDidMount === 'function') inst.componentDidMount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
