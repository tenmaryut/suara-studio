// Renders build/icon.svg to build/icon.png (1024×1024). electron-builder derives the
// Windows .ico, macOS .icns and Linux icon sizes from that PNG.
import { Resvg } from '@resvg/resvg-js'
import { readFile, writeFile } from 'node:fs/promises'

const svg = await readFile(new URL('../build/icon.svg', import.meta.url))
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng()
await writeFile(new URL('../build/icon.png', import.meta.url), png)
console.log(`build/icon.png written (${png.length} bytes)`)
