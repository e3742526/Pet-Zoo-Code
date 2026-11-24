import * as fs from "fs"
import * as path from "path"

import {
	checkGitInstalled,
	searchCommits,
	getCommitInfo,
	getWorkingState,
	getGitRepositoryInfo,
	sanitizeGitUrl,
	extractRepositoryName,
	getWorkspaceGitInfo,
	convertGitUrlToHttps,
	getGitStatus,
} from "../git"
import { truncateOutput } from "../../integrations/misc/extract-text"

type GitExecFile = (
	executable: string,
	args: string[],
	options: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>

const execFileMock = vitest.hoisted(() => vitest.fn<GitExecFile>())

vitest.mock("child_process", () => ({ execFile: execFileMock }))
vitest.mock("util", () => ({ promisify: (execFile: GitExecFile) => execFile }))

// Mock fs.promises
vitest.mock("fs", () => ({
	promises: {
		access: vitest.fn(),
		readFile: vitest.fn(),
	},
}))

// Create a mock for vscode
const mockWorkspaceFolders = vitest.fn()
const mockInspectGitPath = vitest.fn()
let workspaceTrusted = true
vitest.mock("vscode", () => ({
	workspace: {
		get isTrusted() {
			return workspaceTrusted
		},
		getConfiguration: () => ({ inspect: mockInspectGitPath }),
		get workspaceFolders() {
			return mockWorkspaceFolders()
		},
	},
}))

// Mock extract-text
vitest.mock("../../integrations/misc/extract-text", () => ({
	truncateOutput: vitest.fn(function (text) {
		return text
	}),
}))

describe("Git commands", () => {
	const cwd = "/test/path"
	const executable = path.resolve("Git Tools", "git")
	const versionArgs = ["--version"]
	const repoArgs = ["rev-parse", "--git-dir"]
	const statusArgs = ["status", "--porcelain=v1", "--branch"]
	const logArgs = ["log", "-n", "10", "--format=%H%n%h%n%s%n%an%n%ad", "--date=short"]
	const commit = {
		hash: "abc123def456",
		shortHash: "abc123",
		subject: "fix: test commit",
		author: "John Doe",
		date: "2024-01-06",
	}
	const history = [
		...Object.values(commit),
		"def456abc789",
		"def456",
		"feat: new feature",
		"Jane Smith",
		"2024-01-05",
	].join("\n")

	// Mock the subprocess result only. Each test can assert the executable,
	// argument boundaries, and working directory independently.
	function returnGitOutput(...outputs: string[]) {
		for (const stdout of outputs) {
			execFileMock.mockResolvedValueOnce({ stdout, stderr: "" })
		}
	}

	beforeEach(() => {
		vitest.clearAllMocks()
		execFileMock.mockReset().mockRejectedValue(new Error("Unexpected Git command"))
		mockInspectGitPath.mockReset()
		workspaceTrusted = true
	})

	it("checks PATH Git for callers with independent runners", async () => {
		mockInspectGitPath.mockReturnValue({ globalValue: executable })
		returnGitOutput("git version 2.39.2")

		await expect(checkGitInstalled()).resolves.toBe(true)
		expect(execFileMock.mock.calls).toEqual([["git", versionArgs, {}]])
		expect(mockInspectGitPath).not.toHaveBeenCalled()
	})

	it.each(["Git is missing", "Git cannot run"])("returns false when %s", async (message) => {
		execFileMock.mockRejectedValueOnce(new Error(message))
		await expect(checkGitInstalled()).resolves.toBe(false)
		expect(execFileMock.mock.calls).toEqual([["git", versionArgs, {}]])
	})

	it.each([
		{ name: "commit search", run: () => searchCommits("test", cwd), missing: [], outside: [] },
		{
			name: "commit info",
			run: () => getCommitInfo("abc123", cwd),
			missing: "Git is not installed",
			outside: "Not a git repository",
		},
		{
			name: "working state",
			run: () => getWorkingState(cwd),
			missing: "Git is not installed",
			outside: "Not a git repository",
		},
		{ name: "status", run: () => getGitStatus(cwd), missing: null, outside: null },
	])("handles a missing executable or repository for $name", async ({ run, missing, outside }) => {
		await expect(run()).resolves.toEqual(missing)
		expect(execFileMock.mock.calls).toEqual([["git", versionArgs, {}]])

		execFileMock.mockClear()
		returnGitOutput("git version 2.39.2")
		await expect(run()).resolves.toEqual(outside)
		expect(execFileMock.mock.calls).toEqual([
			["git", versionArgs, {}],
			["git", repoArgs, { cwd }],
		])
	})

	it("searches commit messages with the configured executable and a single search argument", async () => {
		mockInspectGitPath.mockReturnValue({ globalValue: executable })
		returnGitOutput("git version 2.39.2", ".git", history)
		const query = 'test "quoted text"'

		const result = await searchCommits(query, cwd)

		expect(result).toHaveLength(2)
		expect(result[0]).toEqual(commit)
		expect(mockInspectGitPath).toHaveBeenCalledWith("path")
		expect(execFileMock.mock.calls).toEqual([
			[executable, versionArgs, {}],
			[executable, repoArgs, { cwd }],
			[executable, [...logArgs, `--grep=${query}`, "--regexp-ignore-case"], { cwd }],
		])
	})

	it("tries the same executable for a hash search after an empty message search", async () => {
		mockInspectGitPath.mockReturnValue({ globalValue: executable })
		returnGitOutput("git version 2.39.2", ".git", "", history)

		const result = await searchCommits("abc123", cwd)

		expect(result).toHaveLength(2)
		expect(result[0]).toEqual(commit)
		expect(execFileMock.mock.calls).toEqual([
			[executable, versionArgs, {}],
			[executable, repoArgs, { cwd }],
			[executable, [...logArgs, "--grep=abc123", "--regexp-ignore-case"], { cwd }],
			[executable, [...logArgs, "--author-date-order", "abc123"], { cwd }],
		])
	})

	it("reads and formats commit metadata, file stats, and changes with the configured executable", async () => {
		mockInspectGitPath.mockReturnValue({ globalValue: executable })
		const stats = "1 file changed, 2 insertions(+), 1 deletion(-)"
		const diff = "@@ -1,1 +1,2 @@\n-old line\n+new line"
		returnGitOutput(
			"git version 2.39.2",
			".git",
			[...Object.values(commit), "Detailed description"].join("\n"),
			stats,
			diff,
		)

		const result = await getCommitInfo("abc123", cwd)

		expect(result).toContain("Commit: abc123")
		expect(result).toContain("Author: John Doe")
		expect(result).toContain(`Files Changed:\n${stats}`)
		expect(result).toContain(`Full Changes:\n\n${diff}`)
		expect(vitest.mocked(truncateOutput)).toHaveBeenCalled()
		expect(execFileMock.mock.calls).toEqual([
			[executable, versionArgs, {}],
			[executable, repoArgs, { cwd }],
			[executable, ["show", "--format=%H%n%h%n%s%n%an%n%ad%n%b", "--no-patch", "abc123"], { cwd }],
			[executable, ["show", "--stat", "--format=", "abc123"], { cwd }],
			[executable, ["show", "--format=", "abc123"], { cwd }],
		])
	})

	it("reads working tree changes with the configured executable", async () => {
		mockInspectGitPath.mockReturnValue({ globalValue: executable })
		returnGitOutput("git version 2.39.2", ".git", " M src/file1.ts\n?? src/file2.ts", "@@ -1,1 +1,2 @@")

		const result = await getWorkingState(cwd)

		expect(result).toContain("Working directory changes:")
		expect(result).toContain("src/file1.ts")
		expect(result).toContain("src/file2.ts")
		expect(vitest.mocked(truncateOutput)).toHaveBeenCalled()
		expect(execFileMock.mock.calls).toEqual([
			[executable, versionArgs, {}],
			[executable, repoArgs, { cwd }],
			[executable, ["status", "--short"], { cwd }],
			[executable, ["diff", "HEAD"], { cwd }],
		])
	})

	it("returns early when the working tree is clean", async () => {
		returnGitOutput("git version 2.39.2", ".git", "")

		await expect(getWorkingState(cwd)).resolves.toBe("No changes in working directory")
		expect(execFileMock).toHaveBeenCalledTimes(3)
	})

	it("tries configured absolute paths in order before using PATH", async () => {
		const unavailable = path.resolve("Missing Git", "git")
		mockInspectGitPath.mockReturnValue({ globalValue: ["./git", unavailable, executable] })
		execFileMock.mockRejectedValueOnce(new Error("Git executable not found"))
		returnGitOutput("git version 2.39.2", ".git", "## main")

		await expect(getGitStatus(cwd)).resolves.toBe("## main")
		expect(execFileMock.mock.calls).toEqual([
			[unavailable, versionArgs, {}],
			[executable, versionArgs, {}],
			[executable, repoArgs, { cwd }],
			[executable, statusArgs, { cwd }],
		])
	})

	it("falls back to PATH when the configured executable fails", async () => {
		mockInspectGitPath.mockReturnValue({ globalValue: executable })
		execFileMock.mockRejectedValueOnce(new Error("Git executable not found"))
		returnGitOutput("git version 2.39.2", ".git", "## main")

		await expect(getGitStatus(cwd)).resolves.toBe("## main")
		expect(execFileMock.mock.calls).toEqual([
			[executable, versionArgs, {}],
			["git", versionArgs, {}],
			["git", repoArgs, { cwd }],
			["git", statusArgs, { cwd }],
		])
	})

	it.each(["workspace setting", "untrusted workspace"])("uses PATH with a %s", async (scope) => {
		workspaceTrusted = scope === "workspace setting"
		mockInspectGitPath.mockReturnValue(
			workspaceTrusted ? { workspaceValue: executable } : { globalValue: executable },
		)
		returnGitOutput("git version 2.39.2", ".git", "## main")

		await expect(getGitStatus(cwd)).resolves.toBe("## main")
		expect(execFileMock.mock.calls).toEqual([
			["git", versionArgs, {}],
			["git", repoArgs, { cwd }],
			["git", statusArgs, { cwd }],
		])
	})

	const changedFiles = Array.from({ length: 29 }, (_, index) => `M  file${index + 1}.ts`)
	it.each([
		{ maxFiles: undefined, lines: changedFiles.slice(0, 20).concat("... 9 more files") },
		{ maxFiles: 0, lines: [] },
		{ maxFiles: 10, lines: changedFiles.slice(0, 10).concat("... 19 more files") },
	])("limits status output to $maxFiles changed files", async ({ maxFiles, lines }) => {
		returnGitOutput("git version 2.39.2", ".git", ["## main...origin/main", ...changedFiles].join("\n"))

		await expect(getGitStatus(cwd, maxFiles)).resolves.toBe(["## main...origin/main", ...lines].join("\n"))
	})

	it("returns null when status output is empty", async () => {
		returnGitOutput("git version 2.39.2", ".git", "")
		await expect(getGitStatus(cwd)).resolves.toBeNull()
	})
})

describe("getGitRepositoryInfo", () => {
	const workspaceRoot = "/test/workspace"
	const gitDir = path.join(workspaceRoot, ".git")
	const configPath = path.join(gitDir, "config")
	const headPath = path.join(gitDir, "HEAD")

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	it("should return empty object when not a git repository", async () => {
		// Mock fs.access to throw error (directory doesn't exist)
		vitest.mocked(fs.promises.access).mockRejectedValueOnce(new Error("ENOENT"))

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({})
		expect(fs.promises.access).toHaveBeenCalledWith(gitDir)
	})

	it("should extract repository info from git config", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Mock git config file content
		const mockConfig = `
[core]
 repositoryformatversion = 0
 filemode = true
 bare = false
 logallrefupdates = true
 ignorecase = true
 precomposeunicode = true
[remote "origin"]
 url = https://github.com/RooCodeInc/Roo-Code.git
 fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
 remote = origin
 merge = refs/heads/main
`
		// Mock HEAD file content
		const mockHead = "ref: refs/heads/main"

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: fs.PathLike | fs.promises.FileHandle, _encoding: unknown) => {
			if (path === configPath) {
				return Promise.resolve(mockConfig)
			} else if (path === headPath) {
				return Promise.resolve(mockHead)
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({
			repositoryUrl: "https://github.com/RooCodeInc/Roo-Code.git",
			repositoryName: "RooCodeInc/Roo-Code",
			defaultBranch: "main",
		})

		// Verify config file was read
		expect(gitSpy).toHaveBeenCalledWith(configPath, "utf8")

		// The implementation might not always read the HEAD file if it already found the branch in config
		// So we don't assert that it was called
	})

	it("should handle missing repository URL in config", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Mock git config file without URL
		const mockConfig = `
[core]
 repositoryformatversion = 0
 filemode = true
 bare = false
`
		// Mock HEAD file content
		const mockHead = "ref: refs/heads/main"

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: fs.PathLike | fs.promises.FileHandle, _encoding: unknown) => {
			if (path === configPath) {
				return Promise.resolve(mockConfig)
			} else if (path === headPath) {
				return Promise.resolve(mockHead)
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({
			defaultBranch: "main",
		})
	})

	it("should handle errors when reading git config", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: fs.PathLike | fs.promises.FileHandle, _encoding: unknown) => {
			if (path === configPath) {
				return Promise.reject(new Error("Failed to read config"))
			} else if (path === headPath) {
				return Promise.resolve("ref: refs/heads/main")
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({
			defaultBranch: "main",
		})
	})

	it("should handle errors when reading HEAD file", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: fs.PathLike | fs.promises.FileHandle, _encoding: unknown) => {
			if (path === configPath) {
				return Promise.resolve(`
[remote "origin"]
 url = https://github.com/RooCodeInc/Roo-Code.git
`)
			} else if (path === headPath) {
				return Promise.reject(new Error("Failed to read HEAD"))
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		expect(result).toEqual({
			repositoryUrl: "https://github.com/RooCodeInc/Roo-Code.git",
			repositoryName: "RooCodeInc/Roo-Code",
		})
	})

	it("should convert SSH URLs to HTTPS format", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		vitest.mocked(fs.promises.access).mockResolvedValue(undefined)

		// Mock git config file with SSH URL
		const mockConfig = `
[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
[remote "origin"]
	url = git@github.com:RooCodeInc/Roo-Code.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
	merge = refs/heads/main
`
		// Mock HEAD file content
		const mockHead = "ref: refs/heads/main"

		// Setup the readFile mock to return different values based on the path
		gitSpy.mockImplementation((path: fs.PathLike | fs.promises.FileHandle, _encoding: unknown) => {
			if (path === configPath) {
				return Promise.resolve(mockConfig)
			} else if (path === headPath) {
				return Promise.resolve(mockHead)
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getGitRepositoryInfo(workspaceRoot)

		// Verify that the SSH URL was converted to HTTPS
		expect(result).toEqual({
			repositoryUrl: "https://github.com/RooCodeInc/Roo-Code.git",
			repositoryName: "RooCodeInc/Roo-Code",
			defaultBranch: "main",
		})
	})
})

describe("convertGitUrlToHttps", () => {
	it("should leave HTTPS URLs unchanged", () => {
		const url = "https://github.com/RooCodeInc/Roo-Code.git"
		const converted = convertGitUrlToHttps(url)

		expect(converted).toBe("https://github.com/RooCodeInc/Roo-Code.git")
	})

	it("should convert SSH URLs to HTTPS format", () => {
		const url = "git@github.com:RooCodeInc/Roo-Code.git"
		const converted = convertGitUrlToHttps(url)

		expect(converted).toBe("https://github.com/RooCodeInc/Roo-Code.git")
	})

	it("should convert SSH URLs with ssh:// prefix to HTTPS format", () => {
		const url = "ssh://git@github.com/RooCodeInc/Roo-Code.git"
		const converted = convertGitUrlToHttps(url)

		expect(converted).toBe("https://github.com/RooCodeInc/Roo-Code.git")
	})

	it("should handle URLs without git@ prefix", () => {
		const url = "ssh://github.com/RooCodeInc/Roo-Code.git"
		const converted = convertGitUrlToHttps(url)

		expect(converted).toBe("https://github.com/RooCodeInc/Roo-Code.git")
	})

	it("should handle invalid URLs gracefully", () => {
		const url = "not-a-valid-url"
		const converted = convertGitUrlToHttps(url)

		expect(converted).toBe("not-a-valid-url")
	})
})

describe("sanitizeGitUrl", () => {
	it("should sanitize HTTPS URLs with credentials", () => {
		const url = "https://username:password@github.com/RooCodeInc/Roo-Code.git"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("https://github.com/RooCodeInc/Roo-Code.git")
	})

	it("should leave SSH URLs unchanged", () => {
		const url = "git@github.com:RooCodeInc/Roo-Code.git"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("git@github.com:RooCodeInc/Roo-Code.git")
	})

	it("should leave SSH URLs with ssh:// prefix unchanged", () => {
		const url = "ssh://git@github.com/RooCodeInc/Roo-Code.git"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("ssh://git@github.com/RooCodeInc/Roo-Code.git")
	})

	it("should remove tokens from other URL formats", () => {
		const url = "https://oauth2:ghp_abcdef1234567890abcdef1234567890abcdef@github.com/RooCodeInc/Roo-Code.git"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("https://github.com/RooCodeInc/Roo-Code.git")
	})

	it("should handle invalid URLs gracefully", () => {
		const url = "not-a-valid-url"
		const sanitized = sanitizeGitUrl(url)

		expect(sanitized).toBe("not-a-valid-url")
	})
})

describe("extractRepositoryName", () => {
	it("should extract repository name from HTTPS URL", () => {
		const url = "https://github.com/RooCodeInc/Roo-Code.git"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})

	it("should extract repository name from HTTPS URL without .git suffix", () => {
		const url = "https://github.com/RooCodeInc/Roo-Code"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})

	it("should extract repository name from SSH URL", () => {
		const url = "git@github.com:RooCodeInc/Roo-Code.git"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})

	it("should extract repository name from SSH URL with ssh:// prefix", () => {
		const url = "ssh://git@github.com/RooCodeInc/Roo-Code.git"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})

	it("should return empty string for unrecognized URL formats", () => {
		const url = "not-a-valid-git-url"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("")
	})

	it("should handle URLs with credentials", () => {
		const url = "https://username:password@github.com/RooCodeInc/Roo-Code.git"
		const repoName = extractRepositoryName(url)

		expect(repoName).toBe("RooCodeInc/Roo-Code")
	})
})

describe("getWorkspaceGitInfo", () => {
	const workspaceRoot = "/test/workspace"

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	it("should return empty object when no workspace folders", async () => {
		// Mock workspace with no folders
		mockWorkspaceFolders.mockReturnValue(undefined)

		const result = await getWorkspaceGitInfo()

		expect(result).toEqual({})
	})

	it("should return git info for the first workspace folder", async () => {
		// Clear previous mocks
		vitest.clearAllMocks()

		// Mock workspace with one folder
		mockWorkspaceFolders.mockReturnValue([{ uri: { fsPath: workspaceRoot }, name: "workspace", index: 0 }])

		// Create a spy to track the implementation
		const gitSpy = vitest.spyOn(fs.promises, "access")
		const readFileSpy = vitest.spyOn(fs.promises, "readFile")

		// Mock successful access to .git directory
		gitSpy.mockResolvedValue(undefined)

		// Mock git config file content
		const mockConfig = `
[remote "origin"]
 url = https://github.com/RooCodeInc/Roo-Code.git
[branch "main"]
 remote = origin
 merge = refs/heads/main
`

		// Setup the readFile mock to return config content
		readFileSpy.mockImplementation((path: fs.PathLike | fs.promises.FileHandle, _encoding: unknown) => {
			if (typeof path === "string" && path.includes("config")) {
				return Promise.resolve(mockConfig)
			}
			return Promise.reject(new Error(`Unexpected path: ${path}`))
		})

		const result = await getWorkspaceGitInfo()

		expect(result).toEqual({
			repositoryUrl: "https://github.com/RooCodeInc/Roo-Code.git",
			repositoryName: "RooCodeInc/Roo-Code",
			defaultBranch: "main",
		})

		// Verify the fs operations were called with the correct workspace path
		expect(gitSpy).toHaveBeenCalled()
		expect(readFileSpy).toHaveBeenCalled()
	})
})
