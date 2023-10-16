const slsw = require('serverless-webpack');

const path = require("path");

module.exports = {
  entry: slsw.lib.entries,
  // target: "node",
  externalsPresets: { node: true }, // in order to ignore built-in modules like path, fs, etc.
  // externals:  {bufferutil: "bufferutil", "utf-8-validate": "utf-8-validate" },
  mode: slsw.lib.webpack.isLocal ? 'development' : 'production',
  devtool: "inline-source-map",
  output: {
    path: path.resolve(__dirname, '.webpack'),
    filename: '[name].mjs',
    chunkFormat: "module",
    libraryTarget: "module",
    module: true
},
  resolve: {
    // Add `.ts` and `.tsx` as a resolvable extension.
    extensions: [".ts", ".tsx", ".js"],
    // Add support for TypeScripts fully qualified ESM imports.
    extensionAlias: {
     ".js": [".js", ".ts"],
     ".cjs": [".cjs", ".cts"],
     ".mjs": [".mjs", ".mts"]
    }
  },
  module: {
    rules: [
      // all files with a `.ts`, `.cts`, `.mts` or `.tsx` extension will be handled by `ts-loader`
      { 
        test: /\.([cm]?ts|tsx)$/, 
        loader: "ts-loader", 
        exclude: [
        [
            path.resolve(__dirname, 'node_modules'),
            path.resolve(__dirname, '.serverless'),
            path.resolve(__dirname, '.webpack'),
        ],
      ], 
    }
    ]
  },
  experiments: {
    topLevelAwait: true,
    outputModule: true
  },
};
