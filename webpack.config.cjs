let path = require('path');

let common = {
  mode: 'production',
  entry: './src/index.js',
  devtool: false,
};

module.exports = [
  {
    ...common,
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
  },
  {
    ...common,
    experiments: {
      outputModule: true,
    },
    output: {
      filename: 'domsculptor.esm.min.js',
      path: path.resolve(__dirname, 'dist'),
      library: {
        type: 'module',
        export: 'default',
      },
    },
  },
];
