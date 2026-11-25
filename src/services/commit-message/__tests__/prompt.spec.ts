import { buildCommitMessagePrompt, getCommitMessage } from "../prompt"

it("masks secret-shaped staged lines before encoding them as prompt data", () => {
	const secrets = [
		'+"service_password": "masked passphrase"',
		"+Authorization: Bearer fake-bearer",
		"+https://user:fake-password@example.invalid",
		"+ghp_" + "a".repeat(23),
		"+-----BEGIN PRIVATE KEY-----\n+fake-key-body\n+-----END PRIVATE KEY-----",
	]
	const prompt = buildCommitMessagePrompt([...secrets, "+A regular change"].join("\n"))
	for (const value of ["masked passphrase", "fake-bearer", "fake-password", "ghp_", "fake-key-body"]) {
		expect(prompt).not.toContain(value)
	}
	expect(prompt).toContain("[REDACTED]")
	expect(prompt).toContain("+A regular change")
})

it.each([
	"",
	"```text\nfix: update settings\n```",
	"Here is the commit message:\n\nfix: update settings",
	"fix: update settings\nBody without a blank line",
	"fix: I will inspect the diff first",
	"fix: update settings\n\nI'll now validate the change.",
	"fix: " + "x".repeat(70),
	"fix: update settings\x1B",
])("discards unsuitable model output %j", (output) => {
	expect(getCommitMessage(output)).toBeUndefined()
})

it("retains the subject and body of a valid message", () => {
	const message = "fix(scm): preserve draft text\n\nKeep edits made while the draft runs."
	expect(getCommitMessage("  " + message.replaceAll("\n", "\r\n") + "\r\n")).toBe(message)
})
