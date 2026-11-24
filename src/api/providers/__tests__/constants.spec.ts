import { DEFAULT_HEADERS } from "../constants"
import { Package } from "../../../shared/package"

describe("DEFAULT_HEADERS", () => {
	it("sends only the fork's versioned user agent", () => {
		expect(DEFAULT_HEADERS).toEqual({ "User-Agent": `PetZooCode/${Package.version}` })
	})
})
