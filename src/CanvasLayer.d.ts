declare namespace CanvasLayer{
    /**
     * A map layer that provides a canvas over the slippy map and a callback
     * system for efficient animation. Requires canvas and CSS 2D transform
     * support.
     */
    export class Layer extends google.maps.OverlayView {
        /**
         * Initializes a new instance of {Layer} class.
         * @param {CanvasLayerOptions=} options Options to set in this CanvasLayer.
         */
        constructor(options);
        /**
         * The canvas element.
         * @type {!HTMLCanvasElement}
         */
        canvas:HTMLCanvasElement;

        /**
         * Sets any options provided. See CanvasLayerOptions for more information.
         * @param {CanvasLayerOptions} options The options to set.
         */
        setOptions(options:CanvasLayer.Options):void;

        /**
         * Set the animated state of the layer. If true, updateHandler will be called
         * repeatedly, once per frame. If false, updateHandler will only be called when
         * a map property changes that could require the canvas content to be redrawn.
         * @param {boolean} animate Whether the canvas is animated.
         */
        setAnimate(animate:boolean):void;

        /**
         * @return {boolean} Whether the canvas is animated.
         */
        isAnimated():boolean;

        /**
         * Set the MapPane in which this layer will be displayed, by name. See
         * {@code google.maps.MapPanes} for the panes available.
         * @param {string} paneName The name of the desired MapPane.
         */
        setPaneName(paneName:string):void;

        /**
         * @return {string} The name of the current container pane.
         */
        getPaneName():string;

        /**
         * Set a function that will be called whenever the parent map and the overlay's
         * canvas have been resized. If opt_resizeHandler is null or unspecified, any
         * existing callback is removed.
         * @param {?function=} opt_resizeHandler The resize callback function.
         */
        setResizeHandler(resizeHandler?:Function):void;

        /**
         * Sets a value for scaling the canvas resolution relative to the canvas
         * display size. This can be used to save computation by scaling the backing
         * buffer down, or to support high DPI devices by scaling it up (by e.g.
         * window.devicePixelRatio).
         * @param {number} scale
         */
        setResolutionScale(scale:number):void;

        /**
         * Set a function that will be called when a repaint of the canvas is required.
         * If opt_updateHandler is null or unspecified, any existing callback is
         * removed.
         * @param {?function=} opt_updateHandler The update callback function.
         */
        setUpdateHandler(updateHandler):void;

        /**
         * A convenience method to get the current LatLng coordinate of the top left of
         * the current view of the map.
         * @return {google.maps.LatLng} The top left coordinate.
         */
        getTopLeft():google.maps.LatLng;

        /**
         * Schedule a requestAnimationFrame callback to updateHandler. If one is
         * already scheduled, there is no effect.
         */
        scheduleUpdate():void;

    }
}

declare function CanvasLayer(options:CanvasLayer.Options):CanvasLayer.Layer;