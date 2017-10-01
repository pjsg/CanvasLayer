/**
 * Copyright 2012 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Extends OverlayView to provide a canvas "Layer".
 * @author Brendan Kenny
 */

/**
 * A map layer that provides a canvas over the slippy map and a callback
 * system for efficient animation. Requires canvas and CSS 2D transform
 * support.
 * @constructor
 * @extends google.maps.OverlayView
 * @param {CanvasLayerOptions=} opt_options Options to set in this CanvasLayer.
 */
function CanvasLayer(opt_options) {
  /**
   * If true, canvas is in a map pane and the OverlayView is fully functional.
   * See google.maps.OverlayView.onAdd for more information.
   * @type {boolean}
   * @private
   */
  this.isAdded_ = false;

  /**
   * If true, each update will immediately schedule the next.
   * @type {boolean}
   * @private
   */
  this.isAnimated_ = false;

  /**
   * The name of the MapPane in which this layer will be displayed.
   * @type {string}
   * @private
   */
  this.paneName_ = CanvasLayer.DEFAULT_PANE_NAME_;

  /**
   * A user-supplied function called whenever an update is required. Null or
   * undefined if a callback is not provided.
   * @type {?function=}
   * @private
   */
  this.updateHandler_ = null;

  /**
   * A user-supplied function called whenever an update is required and the
   * map has been resized since the last update. Null or undefined if a
   * callback is not provided.
   * @type {?function}
   * @private
   */
  this.resizeHandler_ = null;

  /**
   * The LatLng coordinate of the top left of the current view of the map. Will
   * be null when this.isAdded_ is false.
   * @type {google.maps.LatLng}
   * @private
   */
  this.topLeft_ = null;

  /**
   * The map-pan event listener. Will be null when this.isAdded_ is false. Will
   * be null when this.isAdded_ is false.
   * @type {?function}
   * @private
   */
  this.centerListener_ = null;

  /**
   * The map-resize event listener. Will be null when this.isAdded_ is false.
   * @type {?function}
   * @private
   */
  this.resizeListener_ = null;

  /**
   * If true, the map size has changed and this.resizeHandler_ must be called
   * on the next update.
   * @type {boolean}
   * @private
   */
  this.needsResize_ = true;

  /**
   * A browser-defined id for the currently requested callback. Null when no
   * callback is queued.
   * @type {?number}
   * @private
   */
  this.requestAnimationFrameId_ = null;

  var canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.top = 0;
  canvas.style.left = 0;

  /**
   * The canvas element.
   * @type {!HTMLCanvasElement}
   */
  this.canvas = canvas;

  /**
   * The CSS width of the canvas, which may be different than the width of the
   * backing store.
   * @private {number}
   */
  this.canvasCssWidth_ = 300;

  /**
   * The CSS height of the canvas, which may be different than the height of
   * the backing store.
   * @private {number}
   */
  this.canvasCssHeight_ = 150;

  /**
   * A value for scaling the CanvasLayer resolution relative to the CanvasLayer
   * display size.
   * @private {number}
   */
  this.resolutionScale_ = 1;

  /**
   * Simple bind for functions with no args for bind-less browsers (Safari).
   * @param {Object} thisArg The this value used for the target function.
   * @param {function} func The function to be bound.
   */
  function simpleBindShim(thisArg, func) {
    return function () {
      return func.apply(thisArg);
    };
  }

  /**
   * A reference to this.repositionCanvas_ with this bound as its this value.
   * @type {function}
   * @private
   */
  this.repositionFunction_ = simpleBindShim(this, this.repositionCanvas_);

  /**
   * A reference to this.resize_ with this bound as its this value.
   * @type {function}
   * @private
   */
  this.resizeFunction_ = simpleBindShim(this, this.resize_);

  /**
   * A reference to this.update_ with this bound as its this value.
   * @type {function}
   * @private
   */
  this.requestUpdateFunction_ = simpleBindShim(this, this.update_);

  // set provided options, if any
  if (opt_options) {
    this.setOptions(opt_options);
  }
}

CanvasLayer.prototype = new google.maps.OverlayView();

/**
 * The default MapPane to contain the canvas.
 * @type {string}
 * @const
 * @private
 */
CanvasLayer.DEFAULT_PANE_NAME_ = 'overlayLayer';

/**
 * Transform CSS property name, with vendor prefix if required. If browser
 * does not support transforms, property will be ignored.
 * @type {string}
 * @const
 * @private
 */
CanvasLayer.CSS_TRANSFORM_ = function () {
  var div = document.createElement('div');
  var transformProps = ['transform', 'WebkitTransform', 'MozTransform', 'OTransform', 'msTransform'];
  for (var i = 0; i < transformProps.length; i++) {
    var prop = transformProps[i];
    if (div.style[prop] !== undefined) {
      return prop;
    }
  }

  // return unprefixed version by default
  return transformProps[0];
}();

/**
 * The requestAnimationFrame function, with vendor-prefixed or setTimeout-based
 * fallbacks. MUST be called with window as thisArg.
 * @type {function}
 * @param {function} callback The function to add to the frame request queue.
 * @return {number} The browser-defined id for the requested callback.
 * @private
 */
CanvasLayer.prototype.requestAnimFrame_ = window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || window.oRequestAnimationFrame || window.msRequestAnimationFrame || function (callback) {
  return window.setTimeout(callback, 1000 / 60);
};

/**
 * The cancelAnimationFrame function, with vendor-prefixed fallback. Does not
 * fall back to clearTimeout as some platforms implement requestAnimationFrame
 * but not cancelAnimationFrame, and the cost is an extra frame on onRemove.
 * MUST be called with window as thisArg.
 * @type {function}
 * @param {number=} requestId The id of the frame request to cancel.
 * @private
 */
CanvasLayer.prototype.cancelAnimFrame_ = window.cancelAnimationFrame || window.webkitCancelAnimationFrame || window.mozCancelAnimationFrame || window.oCancelAnimationFrame || window.msCancelAnimationFrame || function (requestId) {};

/**
 * Sets any options provided. See CanvasLayerOptions for more information.
 * @param {CanvasLayerOptions} options The options to set.
 */
CanvasLayer.prototype.setOptions = function (options) {
  if (options.animate !== undefined) {
    this.setAnimate(options.animate);
  }

  if (options.paneName !== undefined) {
    this.setPaneName(options.paneName);
  }

  if (options.updateHandler !== undefined) {
    this.setUpdateHandler(options.updateHandler);
  }

  if (options.resizeHandler !== undefined) {
    this.setResizeHandler(options.resizeHandler);
  }

  if (options.resolutionScale !== undefined) {
    this.setResolutionScale(options.resolutionScale);
  }

  if (options.map !== undefined) {
    this.setMap(options.map);
  }
};

/**
 * Set the animated state of the layer. If true, updateHandler will be called
 * repeatedly, once per frame. If false, updateHandler will only be called when
 * a map property changes that could require the canvas content to be redrawn.
 * @param {boolean} animate Whether the canvas is animated.
 */
CanvasLayer.prototype.setAnimate = function (animate) {
  this.isAnimated_ = !!animate;

  if (this.isAnimated_) {
    this.scheduleUpdate();
  }
};

/**
 * @return {boolean} Whether the canvas is animated.
 */
CanvasLayer.prototype.isAnimated = function () {
  return this.isAnimated_;
};

/**
 * Set the MapPane in which this layer will be displayed, by name. See
 * {@code google.maps.MapPanes} for the panes available.
 * @param {string} paneName The name of the desired MapPane.
 */
CanvasLayer.prototype.setPaneName = function (paneName) {
  this.paneName_ = paneName;

  this.setPane_();
};

/**
 * @return {string} The name of the current container pane.
 */
CanvasLayer.prototype.getPaneName = function () {
  return this.paneName_;
};

/**
 * Adds the canvas to the specified container pane. Since this is guaranteed to
 * execute only after onAdd is called, this is when paneName's existence is
 * checked (and an error is thrown if it doesn't exist).
 * @private
 */
CanvasLayer.prototype.setPane_ = function () {
  if (!this.isAdded_) {
    return;
  }

  // onAdd has been called, so panes can be used
  var panes = this.getPanes();
  if (!panes[this.paneName_]) {
    throw new Error('"' + this.paneName_ + '" is not a valid MapPane name.');
  }

  panes[this.paneName_].appendChild(this.canvas);
};

/**
 * Set a function that will be called whenever the parent map and the overlay's
 * canvas have been resized. If opt_resizeHandler is null or unspecified, any
 * existing callback is removed.
 * @param {?function=} opt_resizeHandler The resize callback function.
 */
CanvasLayer.prototype.setResizeHandler = function (opt_resizeHandler) {
  this.resizeHandler_ = opt_resizeHandler;
};

/**
 * Sets a value for scaling the canvas resolution relative to the canvas
 * display size. This can be used to save computation by scaling the backing
 * buffer down, or to support high DPI devices by scaling it up (by e.g.
 * window.devicePixelRatio).
 * @param {number} scale
 */
CanvasLayer.prototype.setResolutionScale = function (scale) {
  if (typeof scale === 'number') {
    this.resolutionScale_ = scale;
    this.resize_();
  }
};

/**
 * Set a function that will be called when a repaint of the canvas is required.
 * If opt_updateHandler is null or unspecified, any existing callback is
 * removed.
 * @param {?function=} opt_updateHandler The update callback function.
 */
CanvasLayer.prototype.setUpdateHandler = function (opt_updateHandler) {
  this.updateHandler_ = opt_updateHandler;
};

/**
 * @inheritDoc
 */
CanvasLayer.prototype.onAdd = function () {
  if (this.isAdded_) {
    return;
  }

  this.isAdded_ = true;
  this.setPane_();

  this.resizeListener_ = google.maps.event.addListener(this.getMap(), 'bounds_changed', this.resizeFunction_);
  this.centerListener_ = google.maps.event.addListener(this.getMap(), 'bounds_changed', this.repositionFunction_);

  this.resize_();
  this.repositionCanvas_();
};

/**
 * @inheritDoc
 */
CanvasLayer.prototype.onRemove = function () {
  if (!this.isAdded_) {
    return;
  }

  this.isAdded_ = false;
  this.topLeft_ = null;

  // remove canvas and listeners for pan and resize from map
  this.canvas.parentElement.removeChild(this.canvas);
  if (this.centerListener_) {
    google.maps.event.removeListener(this.centerListener_);
    this.centerListener_ = null;
  }
  if (this.resizeListener_) {
    google.maps.event.removeListener(this.resizeListener_);
    this.resizeListener_ = null;
  }

  // cease canvas update callbacks
  if (this.requestAnimationFrameId_) {
    this.cancelAnimFrame_.call(window, this.requestAnimationFrameId_);
    this.requestAnimationFrameId_ = null;
  }
};

/**
 * The internal callback for resize events that resizes the canvas to keep the
 * map properly covered.
 * @private
 */
CanvasLayer.prototype.resize_ = function () {
  if (!this.isAdded_) {
    return;
  }

  var map = this.getMap();
  var mapWidth = map.getDiv().offsetWidth;
  var mapHeight = map.getDiv().offsetHeight;

  var newWidth = mapWidth * this.resolutionScale_;
  var newHeight = mapHeight * this.resolutionScale_;
  var oldWidth = this.canvas.width;
  var oldHeight = this.canvas.height;

  // resizing may allocate a new back buffer, so do so conservatively
  if (oldWidth !== newWidth || oldHeight !== newHeight) {
    this.canvas.width = newWidth;
    this.canvas.height = newHeight;

    this.needsResize_ = true;
    this.scheduleUpdate();
  }

  // reset styling if new sizes don't match; resize of data not needed
  if (this.canvasCssWidth_ !== mapWidth || this.canvasCssHeight_ !== mapHeight) {
    this.canvasCssWidth_ = mapWidth;
    this.canvasCssHeight_ = mapHeight;
    this.canvas.style.width = mapWidth + 'px';
    this.canvas.style.height = mapHeight + 'px';
  }
};

/**
 * @inheritDoc
 */
CanvasLayer.prototype.draw = function () {
  this.repositionCanvas_();
};

/**
 * Internal callback for map view changes. Since the Maps API moves the overlay
 * along with the map, this function calculates the opposite translation to
 * keep the canvas in place.
 * @private
 */
CanvasLayer.prototype.repositionCanvas_ = function () {
  // TODO(bckenny): *should* only be executed on RAF, but in current browsers
  //     this causes noticeable hitches in map and overlay relative
  //     positioning.

  var map = this.getMap();

  // topLeft can't be calculated from map.getBounds(), because bounds are
  // clamped to -180 and 180 when completely zoomed out. Instead, calculate
  // left as an offset from the center, which is an unwrapped LatLng.
  var top = map.getBounds().getNorthEast().lat();
  var center = map.getCenter();
  var scale = Math.pow(2, map.getZoom());
  var left = center.lng() - this.canvasCssWidth_ * 180 / (256 * scale);
  this.topLeft_ = new google.maps.LatLng(top, left);

  // Canvas position relative to draggable map's container depends on
  // overlayView's projection, not the map's. Have to use the center of the
  // map for this, not the top left, for the same reason as above.
  var projection = this.getProjection();
  var divCenter = projection.fromLatLngToDivPixel(center);
  var offsetX = -Math.round(this.canvasCssWidth_ / 2 - divCenter.x);
  var offsetY = -Math.round(this.canvasCssHeight_ / 2 - divCenter.y);
  this.canvas.style[CanvasLayer.CSS_TRANSFORM_] = 'translate(' + offsetX + 'px,' + offsetY + 'px)';

  this.scheduleUpdate();
};

/**
 * Internal callback that serves as main animation scheduler via
 * requestAnimationFrame. Calls resize and update callbacks if set, and
 * schedules the next frame if overlay is animated.
 * @private
 */
CanvasLayer.prototype.update_ = function () {
  this.requestAnimationFrameId_ = null;

  if (!this.isAdded_) {
    return;
  }

  if (this.isAnimated_) {
    this.scheduleUpdate();
  }

  if (this.needsResize_ && this.resizeHandler_) {
    this.needsResize_ = false;
    this.resizeHandler_();
  }

  if (this.updateHandler_) {
    this.updateHandler_();
  }
};

/**
 * A convenience method to get the current LatLng coordinate of the top left of
 * the current view of the map.
 * @return {google.maps.LatLng} The top left coordinate.
 */
CanvasLayer.prototype.getTopLeft = function () {
  return this.topLeft_;
};

/**
 * Schedule a requestAnimationFrame callback to updateHandler. If one is
 * already scheduled, there is no effect.
 */
CanvasLayer.prototype.scheduleUpdate = function () {
  if (this.isAdded_ && !this.requestAnimationFrameId_) {
    this.requestAnimationFrameId_ = this.requestAnimFrame_.call(window, this.requestUpdateFunction_);
  }
};

function SunLayer(opt_options) {
  var canvasLayerOptions = {
    animate: false
  };
  CanvasLayer.call(this, canvasLayerOptions);

  this.generation = 0;

  var theThis = this;

  this.canvas.addEventListener("webglcontextlost", function (event) {
    event.preventDefault();
    theThis.generation += 1;
  }, false);

  this.canvas.addEventListener("webglcontextrestored", function (event) {
    event.preventDefault();
    theThis.initialize.apply(theThis);
    theThis.resizeHandler_.apply(theThis);
    theThis.scheduleUpdate.apply(theThis);
  }, false);

  this.cityLights = 1;

  this.getCurrentTime = function () {
    return Date.now() / 1000;
  };

  // set provided options, if any
  if (opt_options) {
    this.setOptions(opt_options);
  }

  if (window.location.hostname && window.location.hostname.search("pskreporter.info") == -1) {
    this.siteprefix = "https://pskreporter.info";
  } else {
    this.siteprefix = "";
  }

  this.initialize();
}

SunLayer.supported = function () {
  var canvas = document.createElement('canvas');
  try {
    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      return 0;
    }
  } catch (err) {
    // Something went very wrong
    return 0;
  }

  // Maybe add more checks here
  return 1;
};

SunLayer.prototype = Object.create(CanvasLayer.prototype);
SunLayer.prototype.constructor = SunLayer;

SunLayer.prototype.setOptions = function (opt_options) {
  CanvasLayer.prototype.setOptions.call(this, opt_options);

  if (opt_options.currentTime) {
    this.setCurrentTime(opt_options.currentTime);
  }
};

SunLayer.prototype.setCityLights = function (state) {
  this.cityLights = state;
};

SunLayer.prototype.hideLights = function () {
  this.cityLights = 0;
};

SunLayer.prototype.showLights = function () {
  this.cityLights = 1;
};

SunLayer.prototype.isHiddenLights = function () {
  return !this.cityLights;
};

SunLayer.prototype.setCurrentTime = function (fn) {
  this.getCurrentTime = fn;
};

SunLayer.prototype.initialize = function () {
  var gl;

  var pointProgram;
  var point_count = 0;
  var updateTimeout = 0;

  var loaddata_bounds;
  var textureUpdate = null;
  var loadedCity = null;
  var loadedTextureInfo = null;

  var canvasId = 0;
  var generation = this.generation;

  function simpleBindShim(thisArg, func) {
    return function () {
      return func.apply(thisArg);
    };
  }

  var all_bessel = [{ "tanf2": 0.0046984, "t0": 1488121131.4, "d": [-8.4916401, 0.015261, 2e-06, 0], "x": [0.175941, 0.5253564, -6.2e-06, -7.4e-06], "y": [-0.42556, 0.1532541, 7.92e-05, -2.1e-06], "l1": [0.55247, -0.0001257, -1.15e-05, 0], "deltat": "68.6", "l2": [0.006301, -0.0001251, -1.15e-05, 0], "tanf1": 0.0047219, "mu": [41.7989387, 15.0030899, 0, 0] }, { "tanf2": 0.0045992, "t0": 1503338331.2, "d": [11.8669596, -0.013622, -2e-06, 0], "x": [-0.129571, 0.5406426, -2.94e-05, -8.1e-06], "y": [0.485416, -0.14164, -9.05e-05, 2e-06], "l1": [0.542093, 0.0001241, -1.18e-05, 0], "deltat": "68.8", "l2": [-0.004025, 0.0001234, -1.17e-05, 0], "tanf1": 0.0046222, "mu": [89.24543, 15.0039396, 0, 0] }, { "tanf2": 0.0047104, "t0": 1518728330.9, "d": [-12.4640398, 0.01408, 3e-06, 0], "x": [0.36362, 0.4990523, -2.12e-05, -5.9e-06], "y": [-1.157549, 0.1283336, 0.0001268, -1.4e-06], "l1": [0.568257, -9.23e-05, -1.03e-05, 0], "deltat": "69.1", "l2": [0.022009, -9.18e-05, -1.02e-05, 0], "tanf1": 0.004734, "mu": [131.4807434, 15.0018196, 0, 0] }, { "tanf2": 0.0045759, "t0": 1531450730.8, "d": [21.8453102, -0.005937, -5e-06, 0], "x": [-0.099286, 0.5828147, -1.3e-06, -9.9e-06], "y": [-1.350769, -0.0332933, -7.7e-05, 5e-07], "l1": [0.530168, -1.18e-05, -1.28e-05, 0], "deltat": "69.2", "l2": [-0.01589, -1.18e-05, -1.27e-05, 0], "tanf1": 0.0045988, "mu": [223.5707855, 15.0002403, 0, 0] }, { "tanf2": 0.0045897, "t0": 1533981530.7, "d": [15.2167301, -0.012076, -3e-06, 0], "x": [0.367508, 0.5684958, -4.77e-05, -9.6e-06], "y": [1.093919, -0.1262935, -0.0001598, 2.1e-06], "l1": [0.531698, 3.38e-05, -1.28e-05, 0], "deltat": "69.3", "l2": [-0.014368, 3.36e-05, -1.27e-05, 0], "tanf1": 0.0046127, "mu": [328.696106, 15.0030804, 0, 0] }, { "tanf2": 0.0047325, "t0": 1546739930.6, "d": [-22.54492, 0.004848, 6e-06, 0], "x": [0.128373, 0.5082384, -1.62e-05, -5.8e-06], "y": [1.144022, 0.0084236, 0.0001036, 0], "l1": [0.572702, 5.75e-05, -1.01e-05, 0], "deltat": "69.4", "l2": [0.026432, 5.72e-05, -1e-05, 0], "tanf1": 0.0047562, "mu": [208.6152954, 14.9967403, 0, 0] }, { "tanf2": 0.0045755, "t0": 1562093930.4, "d": [23.0129509, -0.003187, -5e-06, 0], "x": [-0.215634, 0.5662087, 2.74e-05, -8.8e-06], "y": [-0.650708, 0.0106399, -0.0001272, -3e-07], "l1": [0.537631, -8.98e-05, -1.2e-05, 0], "deltat": "69.6", "l2": [-0.008464, -8.94e-05, -1.2e-05, 0], "tanf1": 0.0045984, "mu": [103.9797287, 14.9995098, 0, 0] }, { "tanf2": 0.0047311, "t0": 1577336328.5, "d": [-23.3734703, 0.001407, 6e-06, 0], "x": [-0.140413, 0.5356103, -1.5e-06, -7.2e-06], "y": [0.424075, -0.0366551, 0.0001458, 6e-07], "l1": [0.558887, 0.0001284, -1.12e-05, 0], "deltat": "71.5", "l2": [0.012686, 0.0001277, -1.11e-05, 0], "tanf1": 0.0047548, "mu": [254.9367676, 14.9962702, 0, 0] }, { "tanf2": 0.004578, "t0": 1592722728.2, "d": [23.4356709, -0.000233, -6e-06, 0], "x": [0.154259, 0.5311546, 2.59e-05, -6.9e-06], "y": [0.136409, 0.0513871, -0.000161, -8e-07], "l1": [0.552318, -0.0001223, -1.07e-05, 0], "deltat": "71.8", "l2": [0.00615, -0.0001217, -1.07e-05, 0], "tanf1": 0.0046009, "mu": [284.5355225, 14.9991102, 0, 0] }, { "tanf2": 0.0047266, "t0": 1607961527.9, "d": [-23.2577591, -0.001986, 6e-06, 0], "x": [-0.181824, 0.5633567, 2.16e-05, -9e-06], "y": [-0.269645, -0.0858122, 0.0001884, 1.5e-06], "l1": [0.543862, 9.7e-05, -1.26e-05, 0], "deltat": "72.1", "l2": [-0.002265, 9.65e-05, -1.25e-05, 0], "tanf1": 0.0047502, "mu": [61.2659111, 14.9965, 0, 0] }, { "tanf2": 0.004583, "t0": 1623322727.7, "d": [23.0422802, 0.002841, -5e-06, 0], "x": [-0.018704, 0.5012289, 3.42e-05, -5.7e-06], "y": [0.926106, 0.0887765, -0.0001797, -1.1e-06], "l1": [0.56438, -5.51e-05, -9.8e-06, 0], "deltat": "72.3", "l2": [0.018151, -5.48e-05, -9.7e-06, 0], "tanf1": 0.004606, "mu": [345.1269226, 14.9991999, 0, 0] }, { "tanf2": 0.0047198, "t0": 1638604727.4, "d": [-22.2747192, -0.005178, 6e-06, 0], "x": [0.025209, 0.5683028, 3.91e-05, -9.7e-06], "y": [-0.983653, -0.1315142, 0.0002213, 2.4e-06], "l1": [0.537805, -1.6e-05, -1.31e-05, 0], "deltat": "72.6", "l2": [-0.008292, -1.6e-05, -1.31e-05, 0], "tanf1": 0.0047434, "mu": [302.452179, 14.9972801, 0, 0] }, { "tanf2": 0.0046189, "t0": 1651352327.2, "d": [14.9710398, 0.012167, -3e-06, 0], "x": [0.61808, 0.4753147, -1.5e-06, -5.7e-06], "y": [-1.028089, 0.2096405, -4.32e-05, -2.7e-06], "l1": [0.561073, 8.47e-05, -1.03e-05, 0], "deltat": "72.8", "l2": [0.014861, 8.43e-05, -1.02e-05, 0], "tanf1": 0.004642, "mu": [135.7055969, 15.00247, 0, 0] }, { "tanf2": 0.0046785, "t0": 1666695526.9, "d": [-12.17348, -0.013746, 3e-06, 0], "x": [0.454792, 0.4955495, 2.77e-05, -7e-06], "y": [0.968771, -0.2395876, 1.67e-05, 3.6e-06], "l1": [0.549879, -0.0001152, -1.16e-05, 0], "deltat": "73.1", "l2": [0.003723, -0.0001146, -1.16e-05, 0], "tanf1": 0.0047019, "mu": [348.9822693, 15.00243, 0, 0] }, { "tanf2": 0.0046318, "t0": 1681963126.6, "d": [11.4117899, 0.013741, -3e-06, 0], "x": [0.02685, 0.4950182, 1.35e-05, -7.1e-06], "y": [-0.427366, 0.2441992, -4.94e-05, -3.7e-06], "l1": [0.546804, 0.0001216, -1.16e-05, 0], "deltat": "73.4", "l2": [0.000663, 0.000121, -1.15e-05, 0], "tanf1": 0.004655, "mu": [240.2429352, 15.0034199, 0, 0] }, { "tanf2": 0.0046648, "t0": 1697306326.3, "d": [-8.2441902, -0.014888, 2e-06, 0], "x": [0.169658, 0.4585533, 2.78e-05, -5.4e-06], "y": [0.334859, -0.2413671, 2.4e-05, 3e-06], "l1": [0.564311, -8.91e-05, -1.03e-05, 0], "deltat": "73.7", "l2": [0.018083, -8.86e-05, -1.03e-05, 0], "tanf1": 0.0046882, "mu": [93.5017319, 15.0035295, 0, 0] }, { "tanf2": 0.004645, "t0": 1712599126, "d": [7.5862002, 0.014844, -2e-06, 0], "x": [-0.318244, 0.5117116, 3.26e-05, -8.4e-06], "y": [0.219764, 0.2709589, -5.95e-05, -4.7e-06], "l1": [0.535814, 6.18e-05, -1.28e-05, 0], "deltat": "74.0", "l2": [-0.010272, 6.15e-05, -1.27e-05, 0], "tanf1": 0.0046683, "mu": [89.591217, 15.0040798, 0, 0] }, { "tanf2": 0.0046501, "t0": 1727895525.7, "d": [-3.9872501, -0.015511, 1e-06, 0], "x": [-0.068048, 0.441617, 1.36e-05, -4.8e-06], "y": [-0.36317, -0.243563, 3.39e-05, 2.8e-06], "l1": [0.570349, -2e-07, -9.8e-06, 0], "deltat": "74.3", "l2": [0.024091, -2e-07, -9.7e-06, 0], "tanf1": 0.0046734, "mu": [107.7310867, 15.0043297, 0, 0] }, { "tanf2": 0.004659, "t0": 1743245925.5, "d": [3.56602, 0.015539, -1e-06, 0], "x": [-0.40287, 0.5094122, 4.15e-05, -8.5e-06], "y": [0.965695, 0.2788348, -7.23e-05, -4.8e-06], "l1": [0.535766, -5.33e-05, -1.29e-05, 0], "deltat": "74.5", "l2": [-0.01032, -5.3e-05, -1.28e-05, 0], "tanf1": 0.0046823, "mu": [343.831665, 15.0043602, 0, 0] }, { "tanf2": 0.0046351, "t0": 1758484725.2, "d": [0.36472, -0.0156, 0, 0], "x": [-0.390072, 0.4531592, 3.2e-06, -5.4e-06], "y": [-1.001834, -0.2521633, 4.56e-05, 3.1e-06], "l1": [0.562492, 9.09e-05, -1.03e-05, 0], "deltat": "74.8", "l2": [0.016273, 9.05e-05, -1.02e-05, 0], "tanf1": 0.0046583, "mu": [121.7819214, 15.0047703, 0, 0] }, { "tanf2": 0.0047085, "t0": 1771329524.9, "d": [-11.8793001, 0.014049, 2e-06, 0], "x": [0.321954, 0.4827224, -3.14e-05, -6.4e-06], "y": [-0.926971, 0.2355394, 0.0001169, -3.3e-06], "l1": [0.55772, -0.0001181, -1.11e-05, 0], "deltat": "75.1", "l2": [0.011524, -0.0001175, -1.11e-05, 0], "tanf1": 0.0047321, "mu": [356.5144043, 15.0019798, 0, 0] }, { "tanf2": 0.0045911, "t0": 1786557524.6, "d": [14.79667, -0.012065, -3e-06, 0], "x": [0.475514, 0.5189249, -7.73e-05, -8e-06], "y": [0.771183, -0.230168, -0.0001246, 3.8e-06], "l1": [0.537955, 9.39e-05, -1.21e-05, 0], "deltat": "75.4", "l2": [-0.008142, 9.35e-05, -1.21e-05, 0], "tanf1": 0.0046141, "mu": [88.7477875, 15.0030899, 0, 0] }, { "tanf2": 0.004719, "t0": 1801929524.3, "d": [-15.5479402, 0.012383, 4e-06, 0], "x": [0.111676, 0.4664952, -3.37e-05, -5.3e-06], "y": [-0.273293, 0.2031856, 0.0001025, -2.5e-06], "l1": [0.571928, -6.53e-05, -1.01e-05, 0], "deltat": "75.7", "l2": [0.025662, -6.5e-05, -1e-05, 0], "tanf1": 0.0047426, "mu": [56.4930687, 15.0005102, 0, 0] }, { "tanf2": 0.0045834, "t0": 1817200724, "d": [17.7624702, -0.010181, -4e-06, 0], "x": [-0.019772, 0.5447123, -4.46e-05, -9.2e-06], "y": [0.160061, -0.2111582, -0.0001217, 3.8e-06], "l1": [0.530596, 1.38e-05, -1.28e-05, 0], "deltat": "76.0", "l2": [-0.015464, 1.37e-05, -1.28e-05, 0], "tanf1": 0.0046064, "mu": [328.4225464, 15.0021, 0, 0] }, { "tanf2": 0.0047264, "t0": 1832511523.7, "d": [-18.7282505, 0.010074, 5e-06, 0], "x": [-0.205283, 0.474257, -3.9e-05, -5.3e-06], "y": [0.34028, 0.1738587, 9.68e-05, -2.1e-06], "l1": [0.574117, 4.2e-05, -9.9e-06, 0], "deltat": "76.3", "l2": [0.02784, 4.18e-05, -9.9e-06, 0], "tanf1": 0.0047501, "mu": [41.8912811, 14.9989595, 0, 0] }, { "tanf2": 0.0045786, "t0": 1847847523.4, "d": [20.1823101, -0.007974, -5e-06, 0], "x": [-0.154409, 0.5449892, -2.14e-05, -8.7e-06], "y": [-0.586424, -0.1746085, -0.0001021, 3e-06], "l1": [0.535237, -8.59e-05, -1.23e-05, 0], "deltat": "76.6", "l2": [-0.010846, -8.54e-05, -1.22e-05, 0], "tanf1": 0.0046016, "mu": [223.3786774, 15.0010204, 0, 0] }, { "tanf2": 0.0047304, "t0": 1863104323.1, "d": [-21.1630096, 0.007241, 6e-06, 0], "x": [-0.407444, 0.5081525, -3.93e-05, -6.5e-06], "y": [0.981055, 0.1455283, 9.21e-05, -2e-06], "l1": [0.562666, 0.0001189, -1.09e-05, 0], "deltat": "76.9", "l2": [0.016446, 0.0001183, -1.08e-05, 0], "tanf1": 0.0047541, "mu": [72.6928863, 14.9976301, 0, 0] }, { "tanf2": 0.0045819, "t0": 1875931122.8, "d": [23.1593208, 0.002591, -5e-06, 0], "x": [-0.010799, 0.5247606, 1.04e-05, -6.5e-06], "y": [1.295413, -0.0176365, -0.0002057, 3e-07], "l1": [0.556662, -0.0001027, -1.04e-05, 0], "deltat": "77.2", "l2": [0.010472, -0.0001022, -1.03e-05, 0], "tanf1": 0.0046048, "mu": [240.0355835, 14.9991999, 0, 0] }, { "tanf2": 0.0045765, "t0": 1878479922.8, "d": [22.0024509, -0.005423, -5e-06, 0], "x": [-0.137347, 0.5252634, -9.6e-06, -7.1e-06], "y": [-1.4271491, -0.1280417, -7.69e-05, 1.9e-06], "l1": [0.548756, -0.0001269, -1.1e-05, 0], "deltat": "77.2", "l2": [0.002605, -0.0001263, -1.09e-05, 0], "tanf1": 0.0045994, "mu": [58.6025696, 15.0000095, 0, 0] }, { "tanf2": 0.0047209, "t0": 1891177122.5, "d": [-22.4454498, -0.005054, 6e-06, 0], "x": [-0.063833, 0.5766353, -2.7e-06, -9.5e-06], "y": [-1.059666, -0.0140165, 0.0002295, 1e-07], "l1": [0.540642, 6.99e-05, -1.28e-05, 0], "deltat": "77.5", "l2": [-0.005469, 6.95e-05, -1.28e-05, 0], "tanf1": 0.0047446, "mu": [47.3098488, 14.9971705, 0, 0] }, { "tanf2": 0.004589, "t0": 1906523922.2, "d": [22.0613003, 0.005581, -5e-06, 0], "x": [-0.269391, 0.5056371, 1.82e-05, -5.7e-06], "y": [0.551977, 0.021015, -0.0001586, -2e-07], "l1": [0.56615, -1.3e-05, -9.7e-06, 0], "deltat": "77.8", "l2": [0.019912, -1.29e-05, -9.7e-06, 0], "tanf1": 0.004612, "mu": [270.5398254, 14.9996996, 0, 0] }, { "tanf2": 0.0047125, "t0": 1921820321.9, "d": [-20.7609997, -0.007989, 5e-06, 0], "x": [0.04415, 0.5787798, 1.77e-05, -9.8e-06], "y": [-0.39266, -0.0551891, 0.0001744, 8e-07], "l1": [0.538213, -3.79e-05, -1.3e-05, 0], "deltat": "78.1", "l2": [-0.007885, -3.77e-05, -1.3e-05, 0], "tanf1": 0.0047361, "mu": [288.2745972, 14.9983597, 0, 0] }, { "tanf2": 0.0045978, "t0": 1937113121.5, "d": [20.1591492, 0.008339, -5e-06, 0], "x": [-0.114781, 0.5112392, 7.2e-06, -6e-06], "y": [-0.211248, 0.057933, -0.0001182, -6e-07], "l1": [0.562405, 8.06e-05, -1e-05, 0], "deltat": "78.5", "l2": [0.016186, 8.02e-05, -1e-05, 0], "tanf1": 0.0046208, "mu": [285.8511353, 15.0006199, 0, 0] }, { "tanf2": 0.0047025, "t0": 1952456321.2, "d": [-18.3368092, -0.010534, 4e-06, 0], "x": [-0.019869, 0.550944, 3.66e-05, -8.2e-06], "y": [0.314971, -0.0890652, 0.0001046, 1.2e-06], "l1": [0.547774, -0.0001068, -1.2e-05, 0], "deltat": "78.8", "l2": [0.001628, -0.0001063, -1.19e-05, 0], "tanf1": 0.004726, "mu": [138.8939819, 14.9997597, 0, 0] }, { "tanf2": 0.0046079, "t0": 1967720320.9, "d": [17.5929108, 0.010694, -4e-06, 0], "x": [-0.07436, 0.5359546, 5.2e-06, -7.4e-06], "y": [-0.965451, 0.0954058, -7.02e-05, -1.3e-06], "l1": [0.548853, 0.0001272, -1.12e-05, 0], "deltat": "79.1", "l2": [0.002702, 0.0001266, -1.12e-05, 0], "tanf1": 0.004631, "mu": [15.8891001, 15.0017405, 0, 0] }, { "tanf2": 0.0046906, "t0": 1983074320.5, "d": [-15.2399197, -0.012633, 3e-06, 0], "x": [0.449239, 0.5120192, 1.7e-05, -6.4e-06], "y": [0.990836, -0.1128683, 4.52e-05, 1.3e-06], "l1": [0.562605, -0.0001127, -1.06e-05, 0], "deltat": "79.5", "l2": [0.016385, -0.0001121, -1.06e-05, 0], "tanf1": 0.0047141, "mu": [274.1191101, 15.0012302, 0, 0] }, { "tanf2": 0.0046574, "t0": 1995818320.3, "d": [4.0936799, 0.015719, -1e-06, 0], "x": [-0.318851, 0.5554244, 2.27e-05, -9.4e-06], "y": [0.924667, 0.175661, -8.01e-05, -2.9e-06], "l1": [0.534943, 2.76e-05, -1.29e-05, 0], "deltat": "79.7", "l2": [-0.011139, 2.75e-05, -1.29e-05, 0], "tanf1": 0.0046807, "mu": [88.9280777, 15.0044498, 0, 0] }, { "tanf2": 0.0046375, "t0": 2011096719.9, "d": [-0.33982, -0.015845, 0, 0], "x": [-0.309996, 0.4815448, 8.7e-06, -5.4e-06], "y": [-1.117005, -0.1545441, 4.78e-05, 1.7e-06], "l1": [0.568897, 3.18e-05, -9.8e-06, 0], "deltat": "80.1", "l2": [0.022646, 3.16e-05, -9.7e-06, 0], "tanf1": 0.0046607, "mu": [31.9424591, 15.0047998, 0, 0] }, { "tanf2": 0.0046718, "t0": 2026461519.6, "d": [-0.05513, 0.016042, 0, 0], "x": [-0.259609, 0.5481629, 2.34e-05, -9e-06], "y": [0.220752, 0.175579, -8e-06, -2.8e-06], "l1": [0.538631, -6.65e-05, -1.27e-05, 0], "deltat": "80.4", "l2": [-0.007469, -6.62e-05, -1.26e-05, 0], "tanf1": 0.0046952, "mu": [328.1391296, 15.0044002, 0, 0] }, { "tanf2": 0.004623, "t0": 2041689519.2, "d": [3.97191, -0.015534, -1e-06, 0], "x": [-0.280906, 0.5028342, -1.07e-05, -6.3e-06], "y": [-0.324339, -0.1577845, -8e-07, 1.9e-06], "l1": [0.557801, 0.0001188, -1.06e-05, 0], "deltat": "80.8", "l2": [0.011605, 0.0001182, -1.05e-05, 0], "tanf1": 0.0046461, "mu": [60.9496994, 15.0049, 0, 0] }, { "tanf2": 0.0046861, "t0": 2057093918.9, "d": [-4.2733402, 0.01592, 1e-06, 0], "x": [0.079469, 0.5205739, 5e-06, -7.3e-06], "y": [-0.432832, 0.1630945, 5.32e-05, -2.2e-06], "l1": [0.552623, -0.0001219, -1.14e-05, 0], "deltat": "81.1", "l2": [0.006453, -0.0001213, -1.14e-05, 0], "tanf1": 0.0047095, "mu": [162.3961334, 15.0038996, 0, 0] }, { "tanf2": 0.0046097, "t0": 2072311118.5, "d": [8.0177097, -0.014783, -2e-06, 0], "x": [0.134282, 0.5377735, -3.6e-05, -8.1e-06], "y": [0.349009, -0.1584651, -5.95e-05, 2.3e-06], "l1": [0.54192, 0.0001103, -1.19e-05, 0], "deltat": "81.5", "l2": [-0.004197, 0.0001098, -1.18e-05, 0], "tanf1": 0.0046328, "mu": [210.0299835, 15.0046396, 0, 0] }, { "tanf2": 0.0046995, "t0": 2087701118.2, "d": [-8.4996901, 0.015281, 2e-06, 0], "x": [0.444043, 0.4934011, -2.01e-05, -5.8e-06], "y": [-1.114319, 0.1445403, 9.97e-05, -1.6e-06], "l1": [0.568192, -9.06e-05, -1.02e-05, 0], "deltat": "81.8", "l2": [0.021945, -9.01e-05, -1.02e-05, 0], "tanf1": 0.0047231, "mu": [251.8083954, 15.0030003, 0, 0] }, { "tanf2": 0.0045789, "t0": 2100423517.9, "d": [19.8942108, -0.008537, -5e-06, 0], "x": [0.090016, 0.5788221, -1.8e-05, -9.9e-06], "y": [-1.447814, -0.0733682, -5.47e-05, 1.2e-06], "l1": [0.530436, -3.06e-05, -1.28e-05, 0], "deltat": "82.1", "l2": [-0.015624, -3.04e-05, -1.27e-05, 0], "tanf1": 0.0046019, "mu": [343.361908, 15.0012398, 0, 0] }, { "tanf2": 0.0045987, "t0": 2102950717.9, "d": [11.74119, -0.013646, -2e-06, 0], "x": [0.036446, 0.5632887, -2.8e-05, -9.6e-06], "y": [1.1103849, -0.1496972, -0.0001354, 2.5e-06], "l1": [0.531908, 4.45e-05, -1.28e-05, 0], "deltat": "82.1", "l2": [-0.014158, 4.43e-05, -1.27e-05, 0], "tanf1": 0.0046217, "mu": [74.2591782, 15.0040302, 0, 0] }, { "tanf2": 0.0047303, "t0": 2115712717.6, "d": [-20.8301106, 0.007969, 6e-06, 0], "x": [-0.013442, 0.5071025, -2.15e-05, -5.8e-06], "y": [1.151491, 0.0475625, 8.75e-05, -5e-07], "l1": [0.572082, 6.33e-05, -1.01e-05, 0], "deltat": "82.4", "l2": [0.025815, 6.3e-05, -1.01e-05, 0], "tanf1": 0.004754, "mu": [327.5504456, 14.9978304, 0, 0] }, { "tanf2": 0.0045764, "t0": 2131066717.2, "d": [21.7824306, -0.006046, -5e-06, 0], "x": [0.141501, 0.5635997, 1e-07, -8.7e-06], "y": [-0.733707, -0.0318217, -0.0001131, 4e-07], "l1": [0.538383, -0.0001101, -1.2e-05, 0], "deltat": "82.8", "l2": [-0.007716, -0.0001096, -1.19e-05, 0], "tanf1": 0.0045993, "mu": [223.5501251, 15.0002298, 0, 0] }];

  function getEclipseDefinition(t) {
    for (var i = 0; i < all_bessel.length; i++) {
      if (all_bessel[i].t0 + 4 * 3600 > t) {
        return all_bessel[i];
      }
    }
    return null;
  }

  var bessel = getEclipseDefinition(this.getCurrentTime());

  function getElements(t1) {
    var t = (t1 - bessel.t0) / 3600;
    var result = {};

    for (var ele in bessel) {
      var val = bessel[ele];
      if (Array.isArray(val)) {
        result[ele] = val[0] + t * val[1] + t * t * val[2] + t * t * t * val[3];
      } else {
        result[ele] = val;
      }
    }

    return result;
  }

  gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');

  if (!gl) {
    return;
  }

  if (0) {
    var loseExtension = gl.getExtension('WEBGL_lose_context');

    window.setTimeout(function () {
      loseExtension.loseContext();
    }, 15 * 1000);

    window.setTimeout(function () {
      loseExtension.restoreContext();
    }, 20 * 1000);
  }

  createShaderProgram();

  var start = this.getCurrentTime();

  var pixelsToWebGLMatrix = new Float32Array(16);
  var mapMatrix = new Float32Array(16);

  var resolutionScale = window.devicePixelRatio || 1;

  var fmod = function fmod(d, v) {
    var q = Math.floor(d / v);
    return d - q * v;
  };

  function getSituation(currentTime) {
    var result = {};

    // Get julian day number. 1-Jan = 1 We ignore leap years
    var fJulianDate = 1 + currentTime / (1000 * 86400.0) - (currentTime.getYear() - 70) * 365.25;

    // Get local time value.
    result.fLocalTime = currentTime % 86400000 / (1000 * 3600.0);

    ////////////////////////////////////////////////////////////
    // CALCULATE SOLAR VALUES
    ////////////////////////////////////////////////////////////

    // Calculate solar declination as per Carruthers et al.
    var t = 2 * Math.PI * fmod((fJulianDate - 1) / 365, 1);

    var fDeclination = 0.322003 - 22.971 * Math.cos(t) - 0.357898 * Math.cos(2 * t) - 0.14398 * Math.cos(3 * t) + 3.94638 * Math.sin(t) + 0.019334 * Math.sin(2 * t) + 0.05928 * Math.sin(3 * t);

    // Convert degrees to radians.
    if (fDeclination > 89.9) fDeclination = 89.9;
    if (fDeclination < -89.9) fDeclination = -89.9;

    // Convert to radians.
    result.fDeclination = fDeclination * (Math.PI / 180.0);

    // Calculate the equation of time as per Carruthers et al.
    t = fmod(279.134 + 0.985647 * fJulianDate, 360) * (Math.PI / 180.0);

    var fEquation = 5.0323 - 100.976 * Math.sin(t) + 595.275 * Math.sin(2 * t) + 3.6858 * Math.sin(3 * t) - 12.47 * Math.sin(4 * t) - 430.847 * Math.cos(t) + 12.5024 * Math.cos(2 * t) + 18.25 * Math.cos(3 * t);

    // Convert seconds to hours.
    result.fEquation = fEquation / 3600.00;

    return result;
  }

  function createShaderProgram() {
    // create vertex shader
    //var vertexSrc = document.getElementById('pointVertexShader').text;
    var vertexSrc = '\n      attribute vec4 worldCoord;\n      attribute vec2 latlngCoord;\n\n      uniform mat4 mapMatrix;\n\n      uniform vec2 u_tl;\n      uniform vec2 u_tl_scale;\n\n      varying vec2 v_latlng;\n      varying vec2 v_cityLightPos;\n\n      void main() {\n        // transform world coordinate by matrix uniform variable\n        gl_Position = mapMatrix * worldCoord;\n        gl_PointSize = 1.0;\n\n        v_cityLightPos = u_tl_scale * (vec2(worldCoord.x, worldCoord.y) - u_tl);\n\n        // a constant size for points, regardless of zoom level\n        //gl_PointSize = 3.;\n        v_latlng = latlngCoord;\n      }\n        ';
    var vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexSrc);
    gl.compileShader(vertexShader);

    // create fragment shader
    //var fragmentSrc = document.getElementById('pointFragmentShader').text;
    var fragmentSrc = '\n      precision mediump float;\n\n      varying vec2 v_latlng;\n      varying vec2 v_cityLightPos;\n\n      uniform float u_tanf1;\n      uniform float u_tanf2;\n      uniform float u_x;\n      uniform float u_y;\n      uniform float u_d;\n      uniform float u_l1;\n      uniform float u_l2;\n      uniform float u_mu;\n      uniform float u_deltat;\n      uniform float u_t0;\n\n      uniform float u_fEquation;\n      uniform float u_fDeclination;\n      uniform float u_fLocalTime;\n\n      uniform float u_obscureFactor;\n      uniform float u_cityLightsEnabled;\n\n      uniform sampler2D u_cityLights;\n\n      void main() {\n        // set pixels in points to something that stands out\n        float obs = 0.;\n        float overrideObs = 0.;\n\n        if (u_deltat > 0.) {\n          float dr = u_d * 3.1415926 / 180.;\n\n          float lng1 = v_latlng.y + 1.002738 * (15. * u_deltat) / 3600.;\n          float H = (u_mu + lng1) * 3.1415926 / 180.;\n          float latr = v_latlng.x * 3.1415926 / 180.;\n          float X = cos(latr) * sin(H);\n          float Y = sin(latr) * cos(dr) - cos(latr) * sin(dr) * cos(H);\n          float Z = sin(latr) * sin(dr) - cos(latr) * cos(dr) * cos(H);\n\n          float d2 = (u_x - X) * (u_x - X) + (u_y - Y) * (u_y - Y);\n\n          float L1 = u_l1 - Z * u_tanf1;\n          float L2 = u_l2 - Z * u_tanf2;\n\n          float d = sqrt(d2);\n\n          if (d < L1) { // && Z < .0) {\n            if (d < abs(L2)) {\n              d = abs(L2);\n              overrideObs = 1.;\n            }\n            obs = (L1 - d) / (L1 + L2);\n            float cutoff = 0.95;\n            if (obs > cutoff) {\n              overrideObs = (obs - cutoff) * (1. - cutoff * u_obscureFactor) / (1. - cutoff) + cutoff * u_obscureFactor;\n            }\n          }\n        }\n\n        float fLatitude = v_latlng.x * 3.1415926 / 180.0;\n        float fLongitude = v_latlng.y * 3.1415926 / 180.0;\n\n        // Calculate difference (in minutes) from reference longitude.\n        float fDifference = (((fLongitude) * 180./3.1415926) * 4.) / 60.0;\n\n        // Caculate solar time.\n        float fSolarTime = u_fLocalTime + u_fEquation + fDifference;\n\n        // Calculate hour angle.\n        float fHourAngle = (15. * (fSolarTime - 12.)) * (3.1415926/180.0);\n\n        // Calculate current altitude.\n        float cc = cos(u_fDeclination) * cos(fLatitude);\n        float t = (sin(u_fDeclination) * sin(fLatitude)) + (cc * cos(fHourAngle));\n        // This turns out to be necessary as sometimes (due to FP errors), the input to\n        // asin can be out of range, and then the shader aborts and it doesn\'t render the pixel\n        if (t > 1.) {\n          t = 1.;\n        } else if (t < -1.) {\n          t = -1.;\n        }\n        float fAltitude = asin(t);\n\n        if (fAltitude < -0.018) {\n          obs = 1.;\n        } else if (fAltitude < 0.018) {\n          obs =  1. - (1. - obs) * (1. - (0.018 - fAltitude) / 0.036);\n        }\n        if (fAltitude < 0.) {\n          overrideObs = 0.;\n        }\n\n        if (obs > 1.) {\n          obs = 1.;\n        } else if (obs < 0.) {\n          obs = 0.;\n        }\n\n        // Once we get into twilight, then people start to turn the lights on.\n        if (obs > 0.90 && u_cityLightsEnabled > 0.) {\n          float lightsAmnt = (obs - 0.90) * 7.0;\n          vec4 nightLight = texture2D(u_cityLights, v_cityLightPos);\n          float lum = ((nightLight.x + nightLight.y + nightLight.z) / 3. - 0.1) * lightsAmnt;\n          gl_FragColor = vec4(lum, lum, lum, max(overrideObs, u_obscureFactor * obs));\n        } else {\n          gl_FragColor = vec4(.0, .0, .0, max(overrideObs, u_obscureFactor * obs));\n        }\n      }\n        ';
    var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentSrc);
    gl.compileShader(fragmentShader);

    var errorMessage = gl.getShaderInfoLog(fragmentShader);
    if (errorMessage) {
      console.log('Frag shader error: ' + errorMessage);
    }

    // link shaders to create our program
    pointProgram = gl.createProgram();
    gl.attachShader(pointProgram, vertexShader);
    gl.attachShader(pointProgram, fragmentShader);
    gl.linkProgram(pointProgram);

    gl.useProgram(pointProgram);
  }

  function centerCoord(v, scale) {
    return (Math.floor(v * scale) + 0.5) / scale;
  }

  function loadData() {
    if (!this.map) {
      return;
    }
    var mapProjection = this.map.getProjection();
    var scale = Math.pow(2, this.map.zoom);
    var width = this.canvas.width;
    var height = this.canvas.height;

    var tl = mapProjection.fromLatLngToPoint(this.getTopLeft());
    var br = { x: tl.x + width / resolutionScale / scale, y: tl.y + height / resolutionScale / scale };

    if (tl.y <= 0) {
      tl.y = 0.0;
    }
    if (br.y > 256) {
      br.y = 256;
    }
    tl.y = centerCoord(tl.y, resolutionScale * scale);
    tl.x = centerCoord(tl.x, resolutionScale * scale);
    br.x = centerCoord(br.x, resolutionScale * scale);

    var rawData = new Float32Array(4 * height);
    //rawData = new Float32Array(4 * height);
    var llData = new Float32Array(4 * height);
    var lngLeft = mapProjection.fromPointToLatLng(new google.maps.Point(tl.x, tl.y)).lng();
    var lngRight = lngLeft + width / resolutionScale / scale / 256 * 360;
    for (var i = 0; i < height; i += 1) {
      var y = tl.y + i / resolutionScale / scale;
      rawData[4 * i] = tl.x;
      rawData[4 * i + 1] = y;
      rawData[4 * i + 2] = br.x;
      rawData[4 * i + 3] = y;
      if (y >= 256) {
        break;
      }
      var lat = mapProjection.fromPointToLatLng(new google.maps.Point(tl.x, y)).lat();
      llData[4 * i] = lat;
      llData[4 * i + 1] = lngLeft;
      llData[4 * i + 2] = lat;
      llData[4 * i + 3] = lngRight;

      point_count = i * 2;
    }

    // create webgl buffer, bind it, and load rawData into it
    var pointArrayBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pointArrayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rawData, gl.STATIC_DRAW);

    // enable the 'worldCoord' attribute in the shader to receive buffer
    var attributeLoc = gl.getAttribLocation(pointProgram, 'worldCoord');
    gl.enableVertexAttribArray(attributeLoc);

    // tell webgl how buffer is laid out (pairs of x,y coords)
    gl.vertexAttribPointer(attributeLoc, 2, gl.FLOAT, false, 0, 0);

    // create webgl buffer, bind it, and load llData into it
    var llArrayBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, llArrayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, llData, gl.STATIC_DRAW);

    // enable the 'worldCoord' attribute in the shader to receive buffer
    var attributeLoc = gl.getAttribLocation(pointProgram, 'latlngCoord');
    gl.enableVertexAttribArray(attributeLoc);

    // tell webgl how buffer is laid out (pairs of x,y coords)
    gl.vertexAttribPointer(attributeLoc, 2, gl.FLOAT, false, 0, 0);

    // load the cityLights texture

    var cWidth;
    for (cWidth = 128; cWidth < width / resolutionScale + 255; cWidth *= 2) {}

    var cHeight;
    for (cHeight = 128; cHeight < height / resolutionScale + 255; cHeight *= 2) {}

    var xOff = Math.floor(tl.x * scale / 256);
    var yOff = Math.floor(tl.y * scale / 256);

    var zoom = this.map.getZoom();

    if (zoom <= 8) {
      var canSkipCanvasLoad = 0;

      var newCity = {
        width: cWidth * 2,
        height: cHeight * 2,
        xOff: xOff,
        yOff: yOff,
        zoom: zoom,
        is_current: simpleBindShim(this, function (c) {
          return this.generation == generation;
        })
      };

      if (loadedCity) {
        canSkipCanvasLoad = loadedCity.width == newCity.width && loadedCity.height == newCity.height && loadedCity.xOff == newCity.xOff && loadedCity.yOff == newCity.yOff && loadedCity.zoom == newCity.zoom;
      }

      if (!canSkipCanvasLoad) {
        if (loadedCity && loadedCity.pending > 0) {
          loadedCity.onceLoaded = simpleBindShim(this, loadData);
          //console.log("Load in progress, deferring");
        } else {
          canvasId += 1;
          //console.log("Ceating new texture canvas id = %d", canvasId);
          newCity.id = canvasId;
          var cityLights = document.createElement('canvas');
          cityLights.width = cWidth * 2;
          cityLights.height = cHeight * 2;

          // Now we want to load the images into this canvas

          var xMax = Math.ceil((width / resolutionScale + 255) / 256);
          var yMax = Math.ceil((height / resolutionScale + 255) / 256);

          var cityLightsContext = cityLights.getContext("2d");

          var newTextureInfo = {
            u_tl: [256 * Math.floor(tl.x * scale / 256) / scale, 256 * Math.floor(tl.y * scale / 256) / scale],
            u_tl_scale: [scale / cityLights.width, scale / cityLights.height]
          };

          newCity.pending = xMax * yMax;
          newCity.textureInfo = newTextureInfo;
          //console.log("Images pending = %d (%d x %d)", newCity.pending, xMax, yMax);

          for (var x = 0; x < xMax; x += 1) {
            for (var y = 0; y < yMax; y += 1) {
              getCityLightsImage(this.siteprefix + "/nighttile/" + zoom + "/" + (x + xOff) % scale + "/" + (scale - 1 - (y + yOff) % scale) + ".png", makeCallback(newCity, cityLights, cityLightsContext, x, y), makeErrorCallback(newCity, cityLights));
            }
          }

          loadedCity = newCity;

          if (!loadedTextureInfo) {
            // Special case to avoid getting a webgl error about no texture being bound
            dobindTexture(cityLights, newCity);
          }
        }
      }
    }
  }

  function dobindTexture(canvas, newCity) {
    if (newCity === loadedCity) {
      var texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(pointProgram, 'u_cityLights'), 0);

      loadedTextureInfo = newCity.textureInfo;

      gl.uniform2fv(gl.getUniformLocation(pointProgram, "u_tl"), loadedTextureInfo.u_tl);
      gl.uniform2fv(gl.getUniformLocation(pointProgram, "u_tl_scale"), loadedTextureInfo.u_tl_scale);
    }

    textureUpdate = null;
  }

  function makeErrorCallback(newCity, canvas) {
    return function () {
      this.onload = null;
      this.onerror = null;
      newCity.pending -= 1;
      //console.log("Error Callback for canvas %d (%d left), image %d,%d", newCity.id, newCity.pending, x, y);
      if (newCity == loadedCity && newCity.is_current()) {
        if (newCity.pending <= 0) {
          textureUpdate = function textureUpdate() {
            dobindTexture(canvas, newCity);
          };
          if (newCity.onceLoaded) {
            newCity.onceLoaded();
            newCity.onceLoaded = null;
          }
        }
      }
    };
  }

  function makeCallback(newCity, canvas, context, x, y) {
    return function () {
      this.onload = null;
      this.onerror = null;
      newCity.pending -= 1;
      //console.log("Callback for canvas %d (%d left), image %d,%d", newCity.id, newCity.pending, x, y);
      if (newCity == loadedCity && newCity.is_current()) {
        context.drawImage(this, x * 256, y * 256);
        if (newCity.pending <= 0) {
          //console.log("Finished loading canvas id = %d", newCity.id);
          textureUpdate = function textureUpdate() {
            dobindTexture(canvas, newCity);
          };
          if (newCity.onceLoaded) {
            newCity.onceLoaded();
            newCity.onceLoaded = null;
          }
        }
      }
    };
  }

  function getCityLightsImage(uri, onload, onerror) {
    var img = document.createElement('img');
    img.onload = onload;
    img.onerror = onerror;
    //if (uri.startsWith("http")) {
    if (uri.lastIndexOf("http", 0) == 0) {
      img.crossOrigin = "";
    }
    img.src = uri;
    return img;
  }

  function resize() {
    var width = this.canvas.width;
    var height = this.canvas.height;

    gl.viewport(0, 0, width, height);

    // Matrix which maps pixel coordinates to WebGL coordinates.
    // If canvasLayer is scaled (with resolutionScale), we need to scale
    // this matrix by the same amount to account for the larger number of
    // pixels.
    pixelsToWebGLMatrix.set([2 * resolutionScale / width, 0, 0, 0, 0, -2 * resolutionScale / height, 0, 0, 0, 0, 0, 0, -1, 1, 0, 1]);
  }

  this.setOptions({ resizeHandler: simpleBindShim(this, resize) });

  function scaleMatrix(matrix, scaleX, scaleY) {
    // scaling x and y, which is just scaling first two columns of matrix
    matrix[0] *= scaleX;
    matrix[1] *= scaleX;
    matrix[2] *= scaleX;
    matrix[3] *= scaleX;

    matrix[4] *= scaleY;
    matrix[5] *= scaleY;
    matrix[6] *= scaleY;
    matrix[7] *= scaleY;
  }

  function translateMatrix(matrix, tx, ty) {
    // translation is in last column of matrix
    matrix[12] += matrix[0] * tx + matrix[4] * ty;
    matrix[13] += matrix[1] * tx + matrix[5] * ty;
    matrix[14] += matrix[2] * tx + matrix[6] * ty;
    matrix[15] += matrix[3] * tx + matrix[7] * ty;
  }

  function update() {
    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = 0;
    }
    if (!this.map) {
      return;
    }

    if (generation != this.generation) {
      return;
    }

    if (textureUpdate) {
      textureUpdate();
    }

    gl.clear(gl.COLOR_BUFFER_BIT);

    //var now = 1503341171 - 3 * 3600 + (Date.now() / 1000 - start) * 100;
    var now = this.getCurrentTime();

    var elements = getElements(now);
    if (Math.abs(now - elements.t0) > 4 * 3600) {
      elements.deltat = -1; // Special marker to disable eclipse processing
    }
    var situation = getSituation(new Date(now * 1000));

    var bounds = this.map.getBounds();
    if (bounds != loaddata_bounds) {
      loadData.apply(this);
      loaddata_bounds = bounds;
    }

    for (var attr in elements) {
      var off = gl.getUniformLocation(pointProgram, "u_" + attr);
      gl.uniform1f(off, elements[attr]);
    }

    for (var attr in situation) {
      var off = gl.getUniformLocation(pointProgram, "u_" + attr);
      gl.uniform1f(off, situation[attr]);
    }

    var off = gl.getUniformLocation(pointProgram, "u_obscureFactor");
    gl.uniform1f(off, 0.65);

    gl.uniform1f(gl.getUniformLocation(pointProgram, "u_cityLightsEnabled"), this.cityLights && this.map.getZoom() <= 8);

    var mapProjection = this.map.getProjection();

    /**
     * We need to create a transformation that takes world coordinate
     * points in the pointArrayBuffer to the coodinates WebGL expects.
     * 1. Start with second half in pixelsToWebGLMatrix, which takes pixel
     *     coordinates to WebGL coordinates.
     * 2. Scale and translate to take world coordinates to pixel coords
     * see https://developers.google.com/maps/documentation/javascript/maptypes#MapCoordinate
     */

    // copy pixel->webgl matrix
    mapMatrix.set(pixelsToWebGLMatrix);

    // Scale to current zoom (worldCoords * 2^zoom)
    var scale = Math.pow(2, this.map.zoom);
    scaleMatrix(mapMatrix, scale, scale);

    // translate to current view (vector from topLeft to 0,0)
    var offset = mapProjection.fromLatLngToPoint(this.getTopLeft());
    var rss = resolutionScale * scale;
    translateMatrix(mapMatrix, -Math.floor(offset.x * rss) / rss, -Math.floor(offset.y * rss) / rss);

    // attach matrix value to 'mapMatrix' uniform in shader
    var matrixLoc = gl.getUniformLocation(pointProgram, 'mapMatrix');
    gl.uniformMatrix4fv(matrixLoc, false, mapMatrix);

    //console.log("%f %f", 
    //    (rawData[0] * mapMatrix[0] + mapMatrix[12]) * this.canvas.width, 
    //    (rawData[1] * mapMatrix[5] + mapMatrix[13]) * this.canvas.height);

    //console.log("%f %f", 
    //    (rawData[2] * mapMatrix[0] + mapMatrix[12]) * this.canvas.width, 
    //    (rawData[3] * mapMatrix[5] + mapMatrix[13]) * this.canvas.height);

    // draw!
    gl.drawArrays(gl.LINES, 0, point_count);

    updateTimeout = window.setTimeout(simpleBindShim(this, update), 1000);
  }

  this.setOptions({ updateHandler: simpleBindShim(this, update) });
};

