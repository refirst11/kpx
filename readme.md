# JTTX &middot; [![powered by SWC](https://img.shields.io/badge/powered%20by-SWC-blue)](https://swc.rs/)

**Just-In-Time TypeScript Transpile Execution** for ESM with [**@swc/core**](https://swc.rs/docs/usage/core)

## Installation

```sh
npm i -D jttx
```

## Usage

Run a TypeScript file **directly**:

```sh
node --import jttx file.ts
```

## Concept

Since **jttx** uses **type: module**, execution will be limited to **ESM**.  
Supported extensions are **.js, .ts, .mjs, .mts, .jsx, .tsx**

## License

jttx is [MIT licensed](https://github.com/refirst11/jitx/blob/main/LICENSE).
