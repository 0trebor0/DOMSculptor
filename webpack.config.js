const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/index.js',
  output: {
    filename: 'domsculptor.min.js',
    path: path.resolve(__dirname, 'dist'),
    library: {
      name: 'DomSculptor',
      type: 'umd',
      export: 'default',
    },
    globalObject: 'this',
  },
};