declare namespace CanvasLayer{
    /**
     * Options for a CanvasLayer.
     *
     * @interface
     */
    export interface Options{
        /**
         * If true, updateHandler will be called repeatedly, once per frame. If false,
         * updateHandler will only be called when a map property changes that could
         * require the canvas content to be redrawn.
         * @type {boolean}
         */
        animate:boolean;

        /**
         * Map on which to overlay the canvas.
         * @type {google.maps.Map}
         */
        map:google.maps.Map;

        /**
         * The name of the MapPane in which this layer will be displayed. See
         * {@code google.maps.MapPanes} for the panes available. Default is
         * "overlayLayer".
         * @type {string}
         */
        paneName:string;

        /**
         * A function that is called whenever the canvas has been resized to fit the
         * map.
         * @type {function}
         */      
        resizeHandler:()=>void;

        /**
         * A value for scaling the CanvasLayer resolution relative to the CanvasLayer
         * display size. This can be used to save computation by scaling the backing
         * buffer down, or to support high DPI devices by scaling it up (by e.g.
         * window.devicePixelRatio).
         * @type {number}
         */
        resolutionScale:number;

        /**
         * A function that is called when a repaint of the canvas is required.
         * @type {function}
         */
        updateHandler:()=>void;
    }
}

declare function CanvasLayerOptions():CanvasLayer.Options;