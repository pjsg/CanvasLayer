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
    return function() { func.apply(thisArg); };
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
CanvasLayer.CSS_TRANSFORM_ = (function() {
  var div = document.createElement('div');
  var transformProps = [
    'transform',
    'WebkitTransform',
    'MozTransform',
    'OTransform',
    'msTransform'
  ];
  for (var i = 0; i < transformProps.length; i++) {
    var prop = transformProps[i];
    if (div.style[prop] !== undefined) {
      return prop;
    }
  }

  // return unprefixed version by default
  return transformProps[0];
})();

/**
 * The requestAnimationFrame function, with vendor-prefixed or setTimeout-based
 * fallbacks. MUST be called with window as thisArg.
 * @type {function}
 * @param {function} callback The function to add to the frame request queue.
 * @return {number} The browser-defined id for the requested callback.
 * @private
 */
CanvasLayer.prototype.requestAnimFrame_ =
    window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.oRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    function(callback) {
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
CanvasLayer.prototype.cancelAnimFrame_ =
    window.cancelAnimationFrame ||
    window.webkitCancelAnimationFrame ||
    window.mozCancelAnimationFrame ||
    window.oCancelAnimationFrame ||
    window.msCancelAnimationFrame ||
    function(requestId) {};

/**
 * Sets any options provided. See CanvasLayerOptions for more information.
 * @param {CanvasLayerOptions} options The options to set.
 */
CanvasLayer.prototype.setOptions = function(options) {
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
CanvasLayer.prototype.setAnimate = function(animate) {
  this.isAnimated_ = !!animate;

  if (this.isAnimated_) {
    this.scheduleUpdate();
  }
};

/**
 * @return {boolean} Whether the canvas is animated.
 */
CanvasLayer.prototype.isAnimated = function() {
  return this.isAnimated_;
};

/**
 * Set the MapPane in which this layer will be displayed, by name. See
 * {@code google.maps.MapPanes} for the panes available.
 * @param {string} paneName The name of the desired MapPane.
 */
CanvasLayer.prototype.setPaneName = function(paneName) {
  this.paneName_ = paneName;

  this.setPane_();
};

/**
 * @return {string} The name of the current container pane.
 */
CanvasLayer.prototype.getPaneName = function() {
  return this.paneName_;
};

/**
 * Adds the canvas to the specified container pane. Since this is guaranteed to
 * execute only after onAdd is called, this is when paneName's existence is
 * checked (and an error is thrown if it doesn't exist).
 * @private
 */
CanvasLayer.prototype.setPane_ = function() {
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
CanvasLayer.prototype.setResizeHandler = function(opt_resizeHandler) {
  this.resizeHandler_ = opt_resizeHandler;
};

/**
 * Sets a value for scaling the canvas resolution relative to the canvas
 * display size. This can be used to save computation by scaling the backing
 * buffer down, or to support high DPI devices by scaling it up (by e.g.
 * window.devicePixelRatio).
 * @param {number} scale
 */
CanvasLayer.prototype.setResolutionScale = function(scale) {
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
CanvasLayer.prototype.setUpdateHandler = function(opt_updateHandler) {
  this.updateHandler_ = opt_updateHandler;
};

/**
 * @inheritDoc
 */
CanvasLayer.prototype.onAdd = function() {
  if (this.isAdded_) {
    return;
  }

  this.isAdded_ = true;
  this.setPane_();

  this.resizeListener_ = google.maps.event.addListener(this.getMap(),
      'bounds_changed', this.resizeFunction_);
  this.centerListener_ = google.maps.event.addListener(this.getMap(),
      'bounds_changed', this.repositionFunction_);

  this.resize_();
  this.repositionCanvas_();
};

/**
 * @inheritDoc
 */
CanvasLayer.prototype.onRemove = function() {
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
CanvasLayer.prototype.resize_ = function() {
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
  if (this.canvasCssWidth_ !== mapWidth ||
      this.canvasCssHeight_ !== mapHeight) {
    this.canvasCssWidth_ = mapWidth;
    this.canvasCssHeight_ = mapHeight;
    this.canvas.style.width = mapWidth + 'px';
    this.canvas.style.height = mapHeight + 'px';
  }
};

/**
 * @inheritDoc
 */
CanvasLayer.prototype.draw = function() {
  this.repositionCanvas_();
};

/**
 * Internal callback for map view changes. Since the Maps API moves the overlay
 * along with the map, this function calculates the opposite translation to
 * keep the canvas in place.
 * @private
 */
CanvasLayer.prototype.repositionCanvas_ = function() {
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
  var left = center.lng() - (this.canvasCssWidth_ * 180) / (256 * scale);
  this.topLeft_ = new google.maps.LatLng(top, left);

  // Canvas position relative to draggable map's container depends on
  // overlayView's projection, not the map's. Have to use the center of the
  // map for this, not the top left, for the same reason as above.
  var projection = this.getProjection();
  var divCenter = projection.fromLatLngToDivPixel(center);
  var offsetX = -Math.round(this.canvasCssWidth_ / 2 - divCenter.x);
  var offsetY = -Math.round(this.canvasCssHeight_ / 2 - divCenter.y);
  this.canvas.style[CanvasLayer.CSS_TRANSFORM_] = 'translate(' +
      offsetX + 'px,' + offsetY + 'px)';

  this.scheduleUpdate();
};

/**
 * Internal callback that serves as main animation scheduler via
 * requestAnimationFrame. Calls resize and update callbacks if set, and
 * schedules the next frame if overlay is animated.
 * @private
 */
CanvasLayer.prototype.update_ = function() {
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
CanvasLayer.prototype.getTopLeft = function() {
  return this.topLeft_;
};

/**
 * Schedule a requestAnimationFrame callback to updateHandler. If one is
 * already scheduled, there is no effect.
 */
CanvasLayer.prototype.scheduleUpdate = function() {
  if (this.isAdded_ && !this.requestAnimationFrameId_) {
    this.requestAnimationFrameId_ =
        this.requestAnimFrame_.call(window, this.requestUpdateFunction_);
  }
};





function SunLayer(opt_options) {
  var canvasLayerOptions = {
    animate: false,
  };
  CanvasLayer.call(this, canvasLayerOptions);

  this.cityLights = 1;

  this.getCurrentTime = function() { return Date.now() / 1000 };

  // set provided options, if any
  if (opt_options) {
    this.setOptions(opt_options);
  }

  this.initialize();
}

SunLayer.prototype = Object.create(CanvasLayer.prototype);
SunLayer.prototype.constructor = SunLayer;

SunLayer.prototype.setOptions = function (opt_options) {
  CanvasLayer.prototype.setOptions.call(this, opt_options);

  if (opt_options.currentTime) {
    this.setCurrentTime(opt_options.currentTime);
  }
}

SunLayer.prototype.setCityLights = function(state) {
  this.cityLights = state;
}

SunLayer.prototype.hideLights = function() {
  this.cityLights = 0;
}

SunLayer.prototype.showLights = function() {
  this.cityLights = 1;
}

SunLayer.prototype.isHiddenLights = function() {
  return !this.cityLights;
}

SunLayer.prototype.setCurrentTime = function(fn) {
  this.getCurrentTime = fn;
}


SunLayer.prototype.initialize = function () {
      var gl;

      var pointProgram;
      var point_count = 0;
      var updateTimeout = 0;

      var loaddata_bounds;
      var textureUpdate = null;
      var loadedCity = null;
      var loadedTextureInfo = null;

      function simpleBindShim(thisArg, func) {
        return function() { func.apply(thisArg); };
      }

      var bessel = {
        "tanf1": 0.0046222,
        "tanf2": 0.0045992,
        "x": [-0.1295710, 0.5406426, -0.0000294, -0.0000081],
        "y": [0.4854160, -0.1416400, -0.0000905, 0.0000020],
        "d": [11.8669596, -0.0136220, -0.0000020, 0.0000000],
        "l1": [0.5420930, 0.0001241, -0.0000118, 0.0000000],
        "l2": [-0.0040250,  0.0001234, -0.0000117, 0.0000000],
        "mu": [89.245430, 15.003940, 0.000000, 0.000000],
        "deltat": 70.3,
        "t0": 1503338400 - 70.3,
        "k1": 0.272488,
        "k2": 0.272281
      };

      function getElements(t1) {
        var t = (t1 - bessel.t0) / 3600;
        var result = {}

        for (var ele in bessel) {
          var val = bessel[ele];
          if (Array.isArray(val)) {
            result[ele] = val[0] + t * val[1] + t*t*val[2] + t*t*t*val[3];
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

      createShaderProgram();

      var start = this.getCurrentTime();

      var pixelsToWebGLMatrix = new Float32Array(16);
      var mapMatrix = new Float32Array(16);

      var resolutionScale = window.devicePixelRatio || 1;

      var fmod = function (d, v) {
        var q = Math.floor(d / v);
        return d - q * v;
      }

      function getSituation(currentTime) {
        var result = {};

        // Get julian day number. 1-Jan = 1 We ignore leap years
        var fJulianDate = 1 + currentTime / (1000 * 86400.0) - (currentTime.getYear() - 70) * 365.25;

        // Get local time value.
        result.fLocalTime = (currentTime % 86400000) / (1000 * 3600.0);


        ////////////////////////////////////////////////////////////
        // CALCULATE SOLAR VALUES
        ////////////////////////////////////////////////////////////

        // Calculate solar declination as per Carruthers et al.
        var t = 2 * Math.PI * fmod((fJulianDate - 1) / 365, 1);

        var fDeclination = (0.322003
              - 22.971 * Math.cos(t)
              - 0.357898 * Math.cos(2*t)
              - 0.14398 * Math.cos(3*t)
              + 3.94638 * Math.sin(t)
              + 0.019334 * Math.sin(2*t)
              + 0.05928 * Math.sin(3*t)
              );

        // Convert degrees to radians.
        if (fDeclination > 89.9) fDeclination = 89.9;
        if (fDeclination < -89.9) fDeclination = -89.9;

        // Convert to radians.
        result.fDeclination = fDeclination * (Math.PI/180.0);

        // Calculate the equation of time as per Carruthers et al.
        t = fmod(279.134 + 0.985647 * fJulianDate, 360) * (Math.PI/180.0);

        var fEquation = (5.0323
              - 100.976 * Math.sin(t)
              + 595.275 * Math.sin(2*t)
              + 3.6858 * Math.sin(3*t)
              - 12.47 * Math.sin(4*t)
              - 430.847 * Math.cos(t)
              + 12.5024 * Math.cos(2*t)
              + 18.25 * Math.cos(3*t)
              );

        // Convert seconds to hours.
        result.fEquation = fEquation / 3600.00;

        return result;
      }

      function createShaderProgram() {
        // create vertex shader
        //var vertexSrc = document.getElementById('pointVertexShader').text;
        var vertexSrc = `
      attribute vec4 worldCoord;
      attribute vec2 latlngCoord;

      uniform mat4 mapMatrix;

      uniform vec2 u_tl;
      uniform vec2 u_tl_scale;

      varying vec2 v_latlng;
      varying vec2 v_cityLightPos;

      void main() {
        // transform world coordinate by matrix uniform variable
        gl_Position = mapMatrix * worldCoord;

        v_cityLightPos = u_tl_scale * (vec2(worldCoord.x, worldCoord.y) - u_tl);

        // a constant size for points, regardless of zoom level
        //gl_PointSize = 3.;
        v_latlng = latlngCoord;
      }
        `;
        var vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexSrc);
        gl.compileShader(vertexShader);

        // create fragment shader
        //var fragmentSrc = document.getElementById('pointFragmentShader').text;
        var fragmentSrc = `
      precision mediump float;

      varying vec2 v_latlng;
      varying vec2 v_cityLightPos;

      uniform float u_tanf1;
      uniform float u_tanf2;
      uniform float u_x;
      uniform float u_y;
      uniform float u_d;
      uniform float u_l1;
      uniform float u_l2;
      uniform float u_mu;
      uniform float u_deltat;
      uniform float u_t0;
      uniform float u_k1;
      uniform float u_k2;

      uniform float u_fEquation;
      uniform float u_fDeclination;
      uniform float u_fLocalTime;

      uniform float u_obscureFactor;
      uniform float u_cityLightsEnabled;

      uniform sampler2D u_cityLights;

      void main() {
        // set pixels in points to something that stands out
        float obs = 0.;
        float overrideObs = 0.;

        if (u_deltat > 0.) {
          float dr = u_d * 3.1415926 / 180.;

          float lng1 = v_latlng.y + 1.002738 * (15. * u_deltat) / 3600.;
          float H = (u_mu + lng1) * 3.1415926 / 180.;
          float latr = v_latlng.x * 3.1415926 / 180.;
          float X = cos(latr) * sin(H);
          float Y = sin(latr) * cos(dr) - cos(latr) * sin(dr) * cos(H);
          float Z = sin(latr) * sin(dr) - cos(latr) * cos(dr) * cos(H);

          float d2 = (u_x - X) * (u_x - X) + (u_y - Y) * (u_y - Y);

          float L1 = u_l1 - Z * u_tanf1;
          float L2 = u_l2 - Z * u_tanf2;

          float d = sqrt(d2);

          if (d < L1) { // && Z < .0) {
            if (d < abs(L2)) {
              d = abs(L2);
              overrideObs = 1.;
            }
            obs = (L1 - d) / (L1 + L2);
            float cutoff = 0.95;
            if (obs > cutoff) {
              overrideObs = (obs - cutoff) * (1. - cutoff * u_obscureFactor) / (1. - cutoff) + cutoff * u_obscureFactor;
            }
          }
        }

        float fLatitude = v_latlng.x * 3.1415926 / 180.0;
        float fLongitude = v_latlng.y * 3.1415926 / 180.0;

        // Calculate difference (in minutes) from reference longitude.
        float fDifference = (((fLongitude) * 180./3.1415926) * 4.) / 60.0;

        // Caculate solar time.
        float fSolarTime = u_fLocalTime + u_fEquation + fDifference;

        // Calculate hour angle.
        float fHourAngle = (15. * (fSolarTime - 12.)) * (3.1415926/180.0);

        // Calculate current altitude.
        float cc = cos(u_fDeclination) * cos(fLatitude);
        float t = (sin(u_fDeclination) * sin(fLatitude)) + (cc * cos(fHourAngle));
        // This turns out to be necessary as sometimes (due to FP errors), the input to
        // asin can be out of range, and then the shader aborts and it doesn't render the pixel
        if (t > 1.) {
          t = 1.;
        } else if (t < -1.) {
          t = -1.;
        }
        float fAltitude = asin(t);

        if (fAltitude < -0.018) {
          obs = 1.;
        } else if (fAltitude < 0.018) {
          obs =  1. - (1. - obs) * (1. - (0.018 - fAltitude) / 0.036);
        }
        if (fAltitude < 0.) {
          overrideObs = 0.;
        }

        if (obs > 1.) {
          obs = 1.;
        } else if (obs < 0.) {
          obs = 0.;
        }

        // Once we get into twilight, then people start to turn the lights on.
        if (obs > 0.90 && u_cityLightsEnabled > 0.) {
          float lightsAmnt = (obs - 0.90) * 7.0;
          vec4 nightLight = texture2D(u_cityLights, v_cityLightPos);
          float lum = ((nightLight.x + nightLight.y + nightLight.z) / 3. - 0.1) * lightsAmnt;
          gl_FragColor = vec4(lum, lum, lum, max(overrideObs, u_obscureFactor * obs));
        } else {
          gl_FragColor = vec4(.0, .0, .0, max(overrideObs, u_obscureFactor * obs));
        }
      }
        `;
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

      function loadData() {
        if (!this.map) {
          return;
        }
        var mapProjection = this.map.getProjection();
        var scale = Math.pow(2, this.map.zoom);
        var width = this.canvas.width;
        var height = this.canvas.height;

        var tl = mapProjection.fromLatLngToPoint(this.getTopLeft());
        var br = { x:tl.x + width / resolutionScale / scale , y: tl.y + height / resolutionScale / scale };

        if (tl.y <= 0) {
          tl.y = 0.05 / scale;
        }
        if (br.y > 256) {
          br.y = 256;
        }

        var rawData = new Float32Array(4 * height);
        var llData = new Float32Array(4 * height);
        var lngLeft = mapProjection.fromPointToLatLng(new google.maps.Point(tl.x, tl.y)).lng();
        var lngRight = lngLeft + width / resolutionScale / scale / 256 * 360;
        for (var i = 0; i < height; i += 1) {
          var y = tl.y + i / resolutionScale / scale;
          rawData[4 * i    ] = tl.x;
          rawData[4 * i + 1] = y;
          rawData[4 * i + 2] = br.x;
          rawData[4 * i + 3] = y;
          if (y >= 256) {
            break;
          }
          var lat = mapProjection.fromPointToLatLng(new google.maps.Point(tl.x, y)).lat();
          llData[4 * i    ] = lat;
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
        for (cWidth = 128; cWidth < (width / resolutionScale) + 255; cWidth *= 2) {
        }

        var cHeight;
        for (cHeight = 128; cHeight < (height / resolutionScale) + 255; cHeight *= 2) {
        }

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
            zoom: zoom
          };

          if (loadedCity) {
            canSkipCanvasLoad = loadedCity.width == newCity.width &&
                                loadedCity.height == newCity.height &&
                                loadedCity.xOff == newCity.xOff &&
                                loadedCity.yOff == newCity.yOff &&
                                loadedCity.zoom == newCity.zoom;
          }

          if (!canSkipCanvasLoad) {
            if (loadedCity && loadedCity.pending > 0) {
              loadedCity.onceLoaded = simpleBindShim(this, loadData);
              console.log("Load in progress, deferring");
            } else {
              var cityLights = document.createElement('canvas');
              cityLights.width = cWidth * 2;
              cityLights.height = cHeight * 2;

              // Now we want to load the images into this canvas

              var xMax = ((width / resolutionScale) + 255) / 256;
              var yMax = ((height / resolutionScale) + 255) / 256;

              var cityLightsContext = cityLights.getContext("2d");

              var newTextureInfo = {
                  u_tl: [256 * Math.floor((tl.x * scale) / 256) / scale, 256 * Math.floor((tl.y * scale) / 256) / scale],
                  u_tl_scale: [scale / cityLights.width, scale / cityLights.height]
              };

              newCity.pending = xMax * yMax;
              newCity.textureInfo = newTextureInfo;

              for (var x = 0; x < xMax; x += 1) {
                for (var y = 0; y < yMax; y += 1) {
                  getCityLightsImage("https://pskreporter.info/nighttile/" + zoom + "/" + (x + xOff) % scale + "/" + (scale - 1 - ((y + yOff) % scale)) + ".png",
                      makeCallback(newCity, cityLights, cityLightsContext, x, y),
                      makeErrorCallback(newCity, cityLights));
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
        return function() {
          this.onload = null;
          this.onerror = null;
          newCity.pending -= 1;
          if (newCity == loadedCity) {
            if (newCity.pending <= 0) {
              textureUpdate = function() { dobindTexture(canvas, newCity) };
              if (newCity.onceLoaded) {
                newCity.onceLoaded();
              }
            }
          }
        }
      }

      function makeCallback(newCity, canvas, context, x, y) {
        return function() {
          this.onload = null;
          this.onerror = null;
          newCity.pending -= 1;
          if (newCity == loadedCity) {
            context.drawImage(this, x * 256, y * 256);
            if (newCity.pending <= 0) {
              textureUpdate = function() { dobindTexture(canvas, newCity) };
              if (newCity.onceLoaded) {
                newCity.onceLoaded();
              }
            }
          }
        }
      }

      function getCityLightsImage(uri, onload, onerror) {
        var img = document.createElement('img');
        img.onload = onload;
        img.onerror = onerror;
        img.crossOrigin = "";
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
        pixelsToWebGLMatrix.set([
          2 * resolutionScale / width, 0, 0, 0,
          0, -2 * resolutionScale / height, 0, 0,
          0, 0, 0, 0,
          -1, 1, 0, 1
        ]);
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
        matrix[12] += matrix[0]*tx + matrix[4]*ty;
        matrix[13] += matrix[1]*tx + matrix[5]*ty;
        matrix[14] += matrix[2]*tx + matrix[6]*ty;
        matrix[15] += matrix[3]*tx + matrix[7]*ty;
      }

      function update() {
        if (updateTimeout) {
          clearTimeout(updateTimeout);
          updateTimeout = 0;
        }
        if (!this.map) {
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
          elements.deltat = -1;         // Special marker to disable eclipse processing
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
        translateMatrix(mapMatrix, -offset.x, -offset.y);

        // attach matrix value to 'mapMatrix' uniform in shader
        var matrixLoc = gl.getUniformLocation(pointProgram, 'mapMatrix');
        gl.uniformMatrix4fv(matrixLoc, false, mapMatrix);

        // draw!
        gl.drawArrays(gl.LINES, 0, point_count);

        updateTimeout = window.setTimeout(simpleBindShim(this, update), 1000);
      }

      this.setOptions({ updateHandler: simpleBindShim(this, update) });
    };
