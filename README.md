#### Vite Plugin Require Resolve

A vite plugin deals with require.resolve() assets, for node-browser mixed-context environment like nw.js etc.

##### Installation

```sh
npm install vite-plugin-require-resolve -D
```

##### Usage

```ts
import vitePluginRequireResolve from 'vite-plugin-require-resolve'

export default defineConfig({
  plugins: [
    vitePluginRequireResolve(),
    ...
  ],
  ...
})
```

##### Result
```ts
// in .ts file
fs.readFileSync(require.resolve('../myUpperDir/Resources/name.ext'))

// will be transform to, 'abcdefgh' will be the first 8 characters of file md5 string
fs.readFileSync(require.resolve('./your-vite-assets-dir/name-abcdefgh.ext'))
```

##### Rules
- **path inside require.resolve() must be relative.**
- **output .js files must be flat with vite assets folder.**

##### License

MIT
