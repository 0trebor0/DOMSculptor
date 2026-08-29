let path = require('path');

module.exports = {
    mode: 'production',
    entry: './src/main.js',
    devtool: false,
    experiments: {
        outputModule: true
    },
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist'),
        module: true,
        library: {
            type: 'module'
        }
    }
};
