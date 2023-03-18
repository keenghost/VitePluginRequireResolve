import path from 'path'
import { PluginOption } from 'vite'
import fs from 'fs-extra'
import pc from 'picocolors'
import md5File from 'md5-file'
import strip_comments from 'strip-comments'

// const REG_EXP = /require\.resolve\(['"][(\.\/)(\.\.\/)][^'"]+['"]\)/
const REG_EXP_G = /require\.resolve\(['"][(\.\/)(\.\.\/)][^'"]+['"]\)/g
const REG_EXP_FOR_MATCH = /require\.resolve\(['"]([(\.\/)(\.\.\/)][^'"]+)['"]\)/
const SIZE_GB = 1024 * 1024 * 1024 * 1
const SIZE_MB = 1024 * 1024 * 1
const SIZE_KB = 1024 * 1

const Helper = {
  AssetsFolderName: '',
  RelativeAssetsDir: '',
  AbsoluteAssetsDir: '',

  // ['D://Projects/Vite/Src/Index.ts']
  ResolvedCodeFileList: [] as Array<string>,

  // ['D://Projects/Vite/Src/Assets/name.ext']
  BlackAssetFileList: [] as Array<string>,

  // <'D://Projects/Vite/Src/Assets/name.ext', 'require.resolve('name-abcdefgh.ext')'>
  AssetRequireMap: new Map<string, string>(),

  // ['D://Projects/Vite/Src/Assets/name.ext', 'abcdefgh', 'name-abcdefgh.ext']
  OutputAssetList: [] as Array<{ AssetPath: string, OutputName: string }>,

  GetSizeDesc: (InSize: number) => {
    if (InSize >= SIZE_GB) {
      return (InSize / SIZE_GB).toFixed(2) + 'GB'
    } else if (InSize >= SIZE_MB) {
      return (InSize / SIZE_MB).toFixed(2) + 'MB'
    } else {
      return (InSize / SIZE_KB).toFixed(2) + 'KB'
    }
  },
}

export default function VitePluginRequireResolve(): PluginOption {
  return {
    name: 'vite-plugin-require-resolve',
    apply: 'build',
    enforce: 'pre',

    async configResolved(ResolvedConfig) {
      Helper.AssetsFolderName = ResolvedConfig.build.assetsDir
      Helper.RelativeAssetsDir = path.join(ResolvedConfig.build.outDir, ResolvedConfig.build.assetsDir).replace(/\\/g, '/')
      Helper.AbsoluteAssetsDir = path.resolve(ResolvedConfig.root, ResolvedConfig.build.outDir, ResolvedConfig.build.assetsDir)
    },

    async transform(Code: string, FileID: string) {
      const CodeFileAbsolutePath = FileID.replace(/(\?.*)$/, '')

      if (Helper.ResolvedCodeFileList.find(Item => Item === CodeFileAbsolutePath)) {
        return null
      }

      const CodeWithoutComments = strip_comments(Code)

      // ['require.resolve('./name.ext')', 'require.resolve('../name.ext')']
      const Matches = CodeWithoutComments.match(REG_EXP_G)

      if (!Matches) {
        Helper.ResolvedCodeFileList.push(CodeFileAbsolutePath)
        return null
      }

      let ReturnCode = Code
      const CodeFileAbsolutePathParsed = path.parse(CodeFileAbsolutePath)

       // <'require.resolve('./name.ext')', 'require.resolve('./name-abcdefgh.ext')'>
      const ResolvedStatementMap = new Map<string, string>()

      // ['require.resolve('./name.ext')']
      const BlackStatementList: Array<string> = []

      for (const RequireResolveStatement of Matches) {
        if (ResolvedStatementMap.has(RequireResolveStatement) || BlackStatementList.includes(RequireResolveStatement)) {
          continue
        }

        // ./name.ext
        const AssetDirMatches = RequireResolveStatement.match(REG_EXP_FOR_MATCH)

        if (!AssetDirMatches || !AssetDirMatches[1]) {
          continue
        }

        const AssetFileAbsolutePath = path.resolve(CodeFileAbsolutePathParsed.dir, AssetDirMatches[1])

        if (Helper.BlackAssetFileList.includes(AssetFileAbsolutePath)) {
          continue
        }

        const AssetFileParsedPath = path.parse(AssetFileAbsolutePath)
        const ExistedStatement = Helper.AssetRequireMap.get(AssetFileAbsolutePath)

        if (ExistedStatement) {
          ResolvedStatementMap.set(RequireResolveStatement, ExistedStatement)
          ReturnCode = ReturnCode.replaceAll(RequireResolveStatement, ExistedStatement)
          continue
        }

        if (!fs.existsSync(AssetFileAbsolutePath)) {
          console.log('\r' +
            pc.bgYellow(pc.black('WARN')) +
            pc.yellow(' [vite-plugin-require-resolve] ') +
            pc.yellow(`${RequireResolveStatement} can't find target file, in ${CodeFileAbsolutePath}`))
          Helper.BlackAssetFileList.push(AssetFileAbsolutePath)
          BlackStatementList.push(RequireResolveStatement)
          continue
        }

        const MD5 = md5File.sync(AssetFileAbsolutePath).substring(0, 8)

        // name-abcdefgh.ext
        const OutputName = AssetFileParsedPath.name + '-' + MD5 + AssetFileParsedPath.ext
        const NewStatement = `require.resolve('./${Helper.AssetsFolderName}/${OutputName}')`

        const OutputAsset = Helper.OutputAssetList.find(Item => Item.OutputName === OutputName)
        if (OutputAsset) {
          if (OutputAsset.AssetPath !== AssetFileAbsolutePath) {
            OutputAsset.AssetPath = AssetFileAbsolutePath
          }
        } else {
          Helper.OutputAssetList.push({
            AssetPath: AssetFileAbsolutePath,
            OutputName: OutputName,
          })
        }

        Helper.AssetRequireMap.set(AssetFileAbsolutePath, NewStatement)
        ResolvedStatementMap.set(RequireResolveStatement, NewStatement)
        ReturnCode = ReturnCode.replaceAll(RequireResolveStatement, NewStatement)
      }

      Helper.ResolvedCodeFileList.push(CodeFileAbsolutePath)

      return ReturnCode
    },

    async closeBundle() {
      const Tasks: Array<{ Src: string, Dest: string, Name: string }> = []
      const ExpiredAssetList: Array<string> = []

      for (const OutputAsset of Helper.OutputAssetList) {
        if (!fs.existsSync(OutputAsset.AssetPath)) {
          ExpiredAssetList.push(OutputAsset.AssetPath)
          continue
        }

        Tasks.push({
          Src: OutputAsset.AssetPath,
          Dest: path.resolve(Helper.AbsoluteAssetsDir, OutputAsset.OutputName),
          Name: OutputAsset.OutputName,
        })
      }

      Helper.OutputAssetList = Helper.OutputAssetList.filter(Item => !ExpiredAssetList.includes(Item.AssetPath))

      const OutputResult: Array<{ Name: string, Size: number }> = []

      await Promise.all(Tasks.map(Task =>
        (async () => {
          await fs.copyFile(Task.Src, Task.Dest)
          OutputResult.push({
            Name: Task.Name,
            Size: (await fs.stat(Task.Src)).size,
          })
        })()
      ))

      for (const Result of OutputResult) {
        console.log('\r' +
          pc.black(Helper.RelativeAssetsDir + '/') +
          pc.green(Result.Name) + '\t' +
          pc.gray(Helper.GetSizeDesc(Result.Size)))
      }

      Helper.ResolvedCodeFileList = []
      Helper.BlackAssetFileList = []
      Helper.AssetRequireMap.clear()
    },
  }
}

module.exports = exports.default
