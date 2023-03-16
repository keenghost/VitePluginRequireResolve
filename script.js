import _ from 'lodash'
import fs from 'fs'

const PackageJson = JSON.parse(fs.readFileSync('./package.json'))

fs.writeFileSync('./dist/package.json', JSON.stringify(_.omit(PackageJson, ['scripts', 'type', 'devDependencies']), null, 2))
fs.copyFileSync('./LICENSE.md', './dist/LICENSE.md')
fs.copyFileSync('./README.md', './dist/README.md')
