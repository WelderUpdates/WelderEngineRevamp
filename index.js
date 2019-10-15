// MIT Licensed (see LICENSE.md).
const execa = require("execa");
const path = require("path");
const mkdirp = require("mkdirp");
const fs = require("fs");
const glob = require("glob");
const os = require("os");
const rimraf = require("rimraf");
const commandExists = require("command-exists").sync;
const yargs = require("yargs");
const findUp = require("find-up");

let hostos = "";
let executableExtension = "";

const initialize = () => {
    switch (os.platform()) {
    case "win32":
        hostos = "Windows";
        executableExtension = ".exe";
        break;
    case "darwin":
        hostos = "Mac";
        break;
    default:
        hostos = "Linux";
        break;
    }
};

initialize();
const repoRootFile = ".welder";

const dirs = (() => {
    const repo = path.dirname(findUp.sync(repoRootFile));
    const libraries = path.join(repo, "Libraries");
    const resources = path.join(repo, "Resources");
    const build = path.join(repo, "Build");
    const prebuiltContent = path.join(build, "PrebuiltContent");

    return {
        build,
        libraries,
        prebuiltContent,
        repo,
        resources
    };
})();

const tryUnlinkSync = (fullPath) => {
    try {
        fs.unlinkSync(fullPath);
        return true;
    } catch (err) {
        return false;
    }
};

const printIndented = (originalText, printer, symbol) => {
    let text = originalText;
    if (!text) {
        return;
    }

    if (text.stack) {
        text = `${text.stack}`;
    } else if (typeof text === "object") {
        text = JSON.stringify(text, null, 2);
    } else {
        text = `${text}`;
    }

    const indent = " ".repeat(8) + symbol;
    const matches = text.match(/[^\r\n]+/gu);
    if (matches) {
        for (const line of matches) {
            printer(indent + line);
        }
    } else if (text) {
        printer(indent + text);
    }
};

const printError = (text) => {
    printIndented(text, console.error, "- ");
    process.exitCode = 1;
};

const printLog = (text) => {
    printIndented(text, console.log, "+ ");
};

const ensureCommandExists = (command) => {
    if (!commandExists(command)) {
        printError(`Command '${command}' does not exist`);
        return false;
    }
    return true;
};

const exec = async (executable, args, options) => {
    const result = execa(executable, args, options);
    const readData = (optionsFunc, name) => {
        const strName = `${name}Str`;
        result[strName] = "";
        if (result[name]) {
            result[name].on("data", (data) => {
                const str = data.toString();
                if (optionsFunc) {
                    optionsFunc(str);
                }
                result[strName] += str;
            });
        }
    };
    readData(options.out, "stdout");
    readData(options.err, "stderr");
    await result;
    return {
        stderr: result.stderrStr,
        stdout: result.stdoutStr
    };
};

const execStdout = async (...args) => (await exec(...args)).stdout;

const execStdoutTrimmed = async (...args) => (await execStdout(...args)).trim();

const gatherSourceFiles = () => {
    console.log("Gathering Source Files");
    const files = glob.sync("**/*.@(c|cc|cxx|cpp|h|hxx|hpp|inl)", {
        cwd: dirs.libraries
    });

    for (let fileIndex = 0; fileIndex < files.length;) {
        const fullPath = path.join(dirs.libraries, files[fileIndex]);
        const code = fs.readFileSync(fullPath, "utf8");

        if (code.startsWith("// External.")) {
            files.splice(fileIndex, 1);
        } else {
            ++fileIndex;
        }
    }
    return files;
};

const runEslint = async (options) => {
    console.log("Running Eslint");
    const eslintOptions = {
        cwd: dirs.repo,
        err: options.validate ? printError : printLog,
        out: options.validate ? printError : printLog,
        reject: false,
        stdio: [
            "ignore",
            "pipe",
            "pipe"
        ]
    };
    const args = [
        "node_modules/eslint/bin/eslint.js",
        "."
    ];

    if (!options.validate) {
        args.push("--fix");
    }

    await exec("node", [
        "node_modules/eslint/bin/eslint.js",
        "."
    ], eslintOptions);
};

const runClangTidy = async (options, sourceFiles) => {
    console.log("Running Clang Tidy");
    if (!ensureCommandExists("clang-tidy")) {
        return;
    }

    // Run clang-tidy.
    const clangTidyOptions = {
        cwd: dirs.libraries,
        reject: false,
        // We only ignore stderr because it prints 'unable to find compile_commands.json'.
        stdio: [
            "ignore",
            "pipe",
            "inherit"
        ]
    };

    for (const filePath of sourceFiles) {
        const fullPath = path.join(dirs.libraries, filePath);
        const oldCode = fs.readFileSync(fullPath, "utf8");

        // We always tell it to fix the file, and we compare it afterward to see if it changed.
        const args = [
            "-extra-arg=-Weverything",
            "-fix",
            "-header-filter=.*",
            filePath
        ];

        // Clang-tidy emits all the errors to the stdout (redirect to stderr).
        const result = await exec("clang-tidy", args, clangTidyOptions);

        if (!options.validate) {
            continue;
        }

        const newCode = fs.readFileSync(fullPath, "utf8");
        if (oldCode !== newCode) {
            printError(`File '${fullPath}' was not clang-tidy'd`);
            printError(result.stdout);

            // Rewrite the original code back.
            fs.writeFileSync(fullPath, oldCode, "utf8");
        }
    }
};

const runClangFormat = async (options, sourceFiles) => {
    console.log("Running Clang Format");
    if (!ensureCommandExists("clang-format")) {
        return;
    }

    const clangFormatOptions = {
        cwd: dirs.libraries,
        reject: false,
        stdio: [
            "ignore",
            "pipe",
            "ignore"
        ],
        stripEof: false,
        stripFinalNewline: false
    };

    await Promise.all(sourceFiles.map(async (filePath) => {
        const result = await exec("clang-format", [filePath], clangFormatOptions);

        const fullPath = path.join(dirs.libraries, filePath);
        const oldCode = fs.readFileSync(fullPath, "utf8");
        const newCode = result.stdout;

        if (oldCode !== newCode) {
            if (options.validate) {
                printError(`File '${fullPath}' was not clang-formatted`);
            } else {
                fs.writeFileSync(fullPath, newCode, "utf8");
            }
        }
    }));
};

const runWelderFormat = async (options, sourceFiles) => {
    console.log("Running Welder Format");

    await Promise.all(sourceFiles.map(async (filePath) => {
        const fullPath = path.join(dirs.libraries, filePath);
        const oldCode = fs.readFileSync(fullPath, "utf8");

        // Split our code into lines (detect Windows newline too so we can remove it).
        const lines = oldCode.split(/\r?\n/u);

        const commentRegex = /^[/*-=\\]+.*/u;

        // Remove any comments from the first lines.
        while (lines.length !== 0) {
            const [line] = lines;
            if (commentRegex.test(line)) {
                lines.shift();
            } else {
                break;
            }
        }

        /*
         * Remove any comments that are long bar comments.
         * Technically this could remove the beginning of a multi-line comment, but our
         * style says it's invalid to have one that has a ton of stars in it anyways.
         */
        const barCommentRegex = /^[/*-=\\]{40}.*/u;

        // These comments may have text after them, but we delete that too intentionally.
        for (let lineIndex = 0; lineIndex < lines.length;) {
            const line = lines[lineIndex];
            if (barCommentRegex.test(line)) {
                lines.splice(lineIndex, 1);
            } else {
                ++lineIndex;
            }
        }

        // Add back in the standard file header (would have been removed above).
        lines.unshift("// MIT Licensed (see LICENSE.md).");

        // Join all lines together with a standard UNIX newline.
        const newCode = lines.join("\n");

        if (oldCode !== newCode) {
            if (options.validate) {
                printError(`File '${fullPath}' must be welder-formatted`);
            } else {
                fs.writeFileSync(fullPath, newCode, "utf8");
            }
        }
    }));
};

const determineCmakeCombo = (options) => {
    const aliases = {
        Empty: {
            architecture: "ANY",
            builder: "Ninja",
            config: "Release",
            platform: "Stub",
            targetos: hostos,
            toolchain: "Clang"
        },
        Emscripten: {
            architecture: "WASM",
            builder: "Ninja",
            config: "Release",
            platform: "Emscripten",
            targetos: "Emscripten",
            toolchain: "Emscripten"
        },
        Linux: {
            architecture: "ANY",
            builder: "Ninja",
            config: "Release",
            platform: "SDLSTDEmpty",
            targetos: "Linux",
            toolchain: "Clang"
        },
        Windows: {
            architecture: "X64",
            builder: "Visual Studio 16 2019",
            config: "Any",
            platform: "Windows",
            targetos: "Windows",
            toolchain: "MSVC"
        }
    };

    const alias = options.alias ? options.alias : hostos;
    let combo = aliases[alias];

    if (!combo) {
        printError(`Undefined alias ${alias}, choosing platform empty`);
        combo = aliases.empty;
    }

    /*
     * Allow options to override builder, toolchian, etc.
     * It is the user's responsibility to ensure this is a valid combination.
     */
    return Object.assign(combo, options);
};

const activateBuildDir = (combo) => {
    const comboStr =
      `${hostos}_${combo.targetos}_${combo.builder}_${combo.toolchain}_${combo.platform}_${combo.architecture}_${combo.config}`.
          replace(/ /gu, "-");
    const comboDir = path.join(dirs.build, comboStr);
    mkdirp.sync(comboDir);

    /*
     * This will always be set to the last build directory the user created (when calling cmake/build).
     * This is used for finding compile_commands.json, cmake artefacts, etc.
     */
    const activeLink = path.join(dirs.build, "Active");
    tryUnlinkSync(activeLink);
    fs.symlinkSync(`./${comboStr}`, activeLink, "junction");
    printLog(`Activated ${comboStr}`);
    return comboDir;
};

const cmake = async (options) => {
    console.log("Running Cmake", options);

    if (!ensureCommandExists("cmake") || !ensureCommandExists("git")) {
        return null;
    }

    const gitOptions = {
        cwd: dirs.repo,
        err: printError,
        reject: false,
        stdio: [
            "ignore",
            "pipe",
            "pipe"
        ]
    };
    const revision = await execStdoutTrimmed("git", [
        "rev-list",
        "--count",
        "HEAD"
    ], gitOptions);
    const shortChangeset = await execStdoutTrimmed("git", [
        "log",
        "-1",
        "--pretty=%h",
        "--abbrev=12"
    ], gitOptions);
    const changeset = await execStdoutTrimmed("git", [
        "log",
        "-1",
        "--pretty=%H"
    ], gitOptions);
    const changesetDate = `"${await execStdoutTrimmed("git", [
        "log",
        "-1",
        "--pretty=%cd",
        "--date=format:%Y-%m-%d"
    ], gitOptions)}"`;

    const builderArgs = [];
    const toolchainArgs = [];
    const architectureArgs = [];
    const configArgs = [];

    const combo = determineCmakeCombo(options);

    if (combo.builder === "Ninja") {
        builderArgs.push("-DCMAKE_MAKE_PROGRAM=ninja");
    }

    if (combo.toolchain === "Emscripten") {
        if (!process.env.EMSCRIPTEN) {
            printError("Cannot find EMSCRIPTEN environment variable");
        }

        const toolchainFile = path.join(process.env.EMSCRIPTEN, "cmake/Modules/Platform/Emscripten.cmake");
        toolchainArgs.push(`-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`);
        toolchainArgs.push("-DEMSCRIPTEN_GENERATE_BITCODE_STATIC_LIBRARIES=1");
    }

    if (combo.toolchain === "Clang") {
        if (hostos === "Windows") {
            // CMake on Windows tries to do a bunch of detection thinking that it will be using MSVC.
            toolchainArgs.push("-DCMAKE_SYSTEM_NAME=Generic");
        }

        toolchainArgs.push("-DCMAKE_C_COMPILER:PATH=clang");
        toolchainArgs.push("-DCMAKE_CXX_COMPILER:PATH=clang++");
        toolchainArgs.push("-DCMAKE_C_COMPILER_ID=Clang");
        toolchainArgs.push("-DCMAKE_CXX_COMPILER_ID=Clang");
        toolchainArgs.push("-DCMAKE_LINKER=lld");
        toolchainArgs.push("-DCMAKE_AR=/usr/bin/llvm-ar");
    }

    if (combo.toolchain === "MSVC" && combo.architecture === "X64") {
        architectureArgs.push("-DCMAKE_GENERATOR_PLATFORM=x64");
        architectureArgs.push("-T");
        architectureArgs.push("host=x64");
    }

    if (combo.toolchain !== "MSVC") {
        configArgs.push(`-DCMAKE_BUILD_TYPE=${combo.config}`);
        configArgs.push("-DCMAKE_EXPORT_COMPILE_COMMANDS=1");
    }

    const cmakeArgs = [
        `-DWELDER_REVISION=${revision}`,
        `-DWELDER_SHORT_CHANGESET=${shortChangeset}`,
        `-DWELDER_CHANGESET=${changeset}`,
        `-DWELDER_CHANGESET_DATE=${changesetDate}`,
        "-G",
        combo.builder,
        ...builderArgs,
        `-DWELDER_TOOLCHAIN=${combo.toolchain}`,
        ...toolchainArgs,
        `-DWELDER_PLATFORM=${combo.platform}`,
        `-DWELDER_ARCHITECTURE=${combo.architecture}`,
        ...architectureArgs,
        ...configArgs,
        `-DWELDER_HOSTOS=${hostos}`,
        `-DWELDER_TARGETOS=${combo.targetos}`,
        dirs.repo
    ];

    printLog(cmakeArgs);
    printLog(combo);

    const buildDir = activateBuildDir(combo);
    rimraf.sync(buildDir);
    mkdirp.sync(buildDir);

    const cmakeOptions = {
        cwd: buildDir,
        err: printError,
        out: printLog,
        reject: false,
        stdio: [
            "ignore",
            "pipe",
            "pipe"
        ]
    };
    mkdirp.sync(dirs.prebuiltContent);
    await exec("cmake", cmakeArgs, cmakeOptions);

    return buildDir;
};

const safeChmod = (file, mode) => {
    try {
        fs.chmodSync(file, mode);
    } catch (err) {
        printError(err);
    }
};

const preventNoOutputTimeout = () => {
    const interval = setInterval(() => {
        printLog("Working...");
    }, 1000 * 10);
    return () => clearInterval(interval);
};

const executables = [
    {
        additionalVfs: [
            "Data",
            repoRootFile
        ],
        name: "WelderEditor",
        resourceLibraries: [
            "FragmentCore",
            "Loading",
            "ZeroCore",
            "UiWidget",
            "EditorUi",
            "Editor"
        ]
    },
    {
        additionalVfs: [
            "Data",
            repoRootFile
        ],
        name: "WelderLauncher",
        resourceLibraries: [
            "FragmentCore",
            "Loading",
            "ZeroCore",
            "ZeroLauncherResources"
        ]
    },
    {
        additionalVfs: [repoRootFile],
        name: "WelderLauncherShell",
        resourceLibraries: []
    }
];

/*
 * Add files to an existing zip. If the file paths are absolute, only the file name will be added to the root,
 * otherwise if the files are relative the entire relative path will be added.
 */
const zipAdd = async (cwd, outputZip, files) => {
    const options = {
        cwd,
        err: printError,
        out: printLog,
        reject: false,
        stdio: [
            "ignore",
            "pipe",
            "pipe"
        ]
    };
    await exec("7z", [
        "a",
        "-tzip",
        "-mx=9",
        "-mfb=128",
        "-mpass=10",
        outputZip,
        ...files
    ], options);
};

const readCmakeVariables = (buildDir) => {
    const cmakeCachePath = path.join(buildDir, "CMakeCache.txt");
    const contents = fs.readFileSync(cmakeCachePath, "utf8");
    const regex = /(?<name>[a-zA-Z0-9_-]+):UNINITIALIZED=(?<value>.*)/gu;

    const result = {};
    for (;;) {
        const array = regex.exec(contents);
        if (!array) {
            break;
        }
        result[array.groups.name] = array.groups.value;
    }
    return result;
};

const runBuild = async (buildDir, testExecutablePaths, opts) => {
    console.log("Running Build");
    if (!ensureCommandExists("cmake")) {
        return;
    }

    const cmakeVariables = readCmakeVariables(buildDir);
    for (const executable of executables) {
        console.log(`Zipping virtual file system for ${executable.name}`);

        const libraryDir = path.join(buildDir, "Libraries", executable.name);
        mkdirp.sync(libraryDir);
        const fileSystemZip = path.join(libraryDir, "FileSystem.zip");
        tryUnlinkSync(fileSystemZip);

        const files = [...executable.additionalVfs];
        for (const resourceLibrary of executable.resourceLibraries) {
            files.push(path.join(dirs.resources, resourceLibrary));

            // This must match the revisionChangesetName in ContentLogic.cpp:
            const revisionChangesetName = `Version-${cmakeVariables.WELDER_REVISION}-${cmakeVariables.WELDER_CHANGESET}`;
            const prebuiltPath = path.join(dirs.prebuiltContent, revisionChangesetName, resourceLibrary);
            if (fs.existsSync(prebuiltPath)) {
                files.push(prebuiltPath);
            } else {
                printLog(`Skipping prebuilt content for ${resourceLibrary}`);
            }
        }

        const relativeFiles = files.map((file) => path.relative(dirs.repo, file));
        await zipAdd(dirs.repo, fileSystemZip, relativeFiles);
    }


    const options = {
        cwd: buildDir,
        err: printError,
        out: (text) => {
            if (text.search(/(FAILED|failed|ERROR)/u) === -1) {
                printLog(text);
            } else {
                printError(text);
            }
        },
        reject: false,
        stdio: [
            "ignore",
            "pipe",
            "pipe"
        ]
    };

    const makeArgArray = (optsName) => opts[optsName] ? [
        `--${optsName}`,
        opts[optsName]
    ] : [];

    const target = makeArgArray("target");
    const parallel = makeArgArray("parallel");

    const endPnot = preventNoOutputTimeout();
    const config = opts.config ? opts.config : "Release";
    await exec("cmake", [
        "--build",
        ".",
        "--config",
        config,
        ...target,
        ...parallel
    ], options);
    endPnot();

    const addExecutable = (file) => {
        if (fs.existsSync(file)) {
            safeChmod(file, 0o777);
            testExecutablePaths.push(file);
        }
    };

    addExecutable(path.join(buildDir, config, `ne${executableExtension}`));
    addExecutable(path.join(buildDir, `ne${executableExtension}`));
};

const format = async (options) => {
    console.log("Formatting");
    await runEslint(options);
    const sourceFiles = gatherSourceFiles();
    if (options.tidy) {
        await runClangTidy(options, sourceFiles);
    }
    await runClangFormat(options, sourceFiles);
    await runWelderFormat(options, sourceFiles);

    /*
     * TODO(Trevor.Sundberg): Run cmake_format.
     * TODO(Trevor.Sundberg): Run cppcheck.
     * TODO(Trevor.Sundberg): Run cpplint.'
     * TODO(Trevor.Sundberg): Run moxygen.
     */
    console.log("Formatted");
};

const build = async (options) => {
    console.log("Building");
    const combo = determineCmakeCombo(options);
    const buildDir = activateBuildDir(combo);
    const testExecutablePaths = [];
    await runBuild(buildDir, testExecutablePaths, options);
    // Await runTests(testExecutablePaths);
    console.log("Built");
};

const prebuilt = async (options) => {
    console.log("Copying Prebuilt Content");
    const combo = determineCmakeCombo(options);
    if (combo.toolchain === "Emscripten") {
        console.log(`Skipping prebuilt content for toolchain '${combo.toolchain}'`);
        return;
    }
    const buildDir = activateBuildDir(combo);
    const editorPath = path.join(buildDir, "Libraries", "WelderEditor", `WelderEditor${executableExtension}`);

    if (!fs.existsSync(editorPath)) {
        printError(`Executable does not exit ${editorPath}`);
        return;
    }

    const opts = {
        cwd: buildDir,
        err: printError,
        out: printLog,
        reject: false,
        stdio: [
            "ignore",
            "pipe",
            "pipe"
        ]
    };
    await exec(editorPath, [
        "-CopyPrebuiltContent",
        "-Exit"
    ], opts);

    if (!fs.existsSync(dirs.prebuiltContent) || fs.readdirSync(dirs.prebuiltContent).length === 0) {
        printError("Prebuilt content directory did not exist or was empty");
    }
    console.log("Copied Prebuilt Content");
};

const pack = async (options) => {
    console.log("Packing");
    const combo = determineCmakeCombo(options);
    const buildDir = activateBuildDir(combo);

    const filter = [
        ".pdb",
        ".ilk",
        ".exp",
        ".lib",
        ".wast",
        ".cmake",
        "CMakeFiles",
        "FileSystem.zip"
    ];

    for (const executable of executables) {
        const library = executable.name;
        console.log(`Packaging library ${library}`);

        const libraryDir = path.join(buildDir, "Libraries", library);
        if (!fs.existsSync(libraryDir)) {
            printError(`Library directory does not exist ${libraryDir}`);
            continue;
        }
        const files = fs.readdirSync(libraryDir).filter((file) => !filter.includes(path.extname(file)) && !filter.includes(file)).
            map((file) => path.join(libraryDir, file));
        const packageZip = path.join(buildDir, `${library}Package.zip`);
        tryUnlinkSync(packageZip);
        if (combo.toolchain !== "Emscripten") {
            const fileSystemZip = path.join(libraryDir, "FileSystem.zip");
            fs.copyFileSync(fileSystemZip, packageZip);
        }

        // Keep files as absolute, since we want to only add the file names to the zip.
        await zipAdd(dirs.repo, packageZip, files);
    }
    console.log("Packed");
};

const documentation = async () => {
    console.log("Running Doxygen");
    if (!ensureCommandExists("doxygen")) {
        return;
    }
    const doxygenOptions = {
        cwd: dirs.repo,
        err: printError,
        out: printLog,
        reject: false,
        stdio: "pipe"
    };
    const doxyFile = fs.readFileSync("./Documentation/Doxyfile", "utf8");
    const libraryNames = fs.readdirSync(dirs.libraries);

    const libraryDirs = libraryNames.
        map((library) => path.join(dirs.libraries, library)).
        filter((fullPath) => fs.statSync(fullPath).isDirectory());

    await Promise.all(libraryDirs.map(async (libraryDir) => {
        const outputDir = `Build/Documentation/${path.basename(libraryDir)}`;
        const warnLog = path.join(outputDir, "warnings.log");
        mkdirp.sync(outputDir);
        const doxyFileSpecific = `${doxyFile}\nINPUT="${libraryDir}"\nOUTPUT_DIRECTORY="${outputDir}"\nWARN_LOGFILE="${warnLog}"`;
        await exec("doxygen", ["-"], {...doxygenOptions, input: doxyFileSpecific});
    }));
};

const all = async (options) => {
    await format({...options, validate: true});
    await cmake(options);
    await build(options);
    await prebuilt(options);
    await documentation(options);
    await pack(options);
};

const main = async () => {
    const empty = {
    };
    const comboOptions = "[--alias=...] [--builder=...] [--toolchain=...] [--platform=...] [--architecture=...] [--config] [--targetos=...]";
    // eslint-disable-next-line
    yargs.
        command("format", "Formats all C/C++ files", empty, format).
        usage("format [--validate]").
        command("cmake", "Generate a cmake project", empty, cmake).
        usage(`cmake ${comboOptions}`).
        command("build", "Build a cmake project (options must match generated version)", empty, build).
        usage(`build [--target=...] [--parallel=...] ${comboOptions}`).
        command("documentation", "Build generated documentation", empty, documentation).
        usage("documentation").
        command("prebuilt", "Copy prebuilt content", empty, prebuilt).
        usage(`prebuilt ${comboOptions}`).
        command("pack", "Package everything into standalone installable archives", empty, pack).
        usage(`pack ${comboOptions}`).
        command("all", "Run all the expected commands in order: cmake build prebuilt documentation pack", empty, all).
        usage(`all ${comboOptions}`).
        demand(1).
        help().
        argv;
};
main();
