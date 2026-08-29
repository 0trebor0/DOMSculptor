let path = require('path');
let webpack = require('webpack');

let babel = (test, options) => ({
    test,
    loader: 'babel-loader',
    options: { babelrc: false, configFile: false, ...options }
});

module.exports = {
    mode: 'production',
    entry: './src/harness.js',
    devtool: false,
    experiments: {
        outputModule: true
    },
    output: {
        filename: 'harness.js',
        path: path.resolve(__dirname, 'dist'),
        module: true,
        library: { type: 'module' }
    },
    resolve: {
        extensions: ['.js', '.jsx'],
        alias: {
            vue: 'vue/dist/vue.runtime.esm-bundler.js',
            // The comparison is against the working tree, not a published tarball.
            domsculptor: path.resolve(__dirname, '../../src/index.js')
        }
    },
    module: {
        rules: [
            babel(/impl-react\.jsx$/, { presets: [['@babel/preset-react', { runtime: 'automatic' }]] }),
            babel(/impl-preact\.jsx$/, {
                presets: [['@babel/preset-react', { runtime: 'automatic', importSource: 'preact' }]]
            }),
            babel(/impl-solid\.jsx$/, { presets: ['babel-preset-solid'] })
        ]
    },
    plugins: [
        // Each framework's bundler build strips its development code behind these
        // flags; without them the comparison would time development builds.
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('production'),
            __VUE_OPTIONS_API__: 'false',
            __VUE_PROD_DEVTOOLS__: 'false',
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
        })
    ]
};
