import { render, screen } from "@/utils/test-utils"

import RooHero from "../RooHero"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => (key === "welcome:landing.logoAlt" ? "Dory Code logo" : key),
	}),
}))

describe("RooHero", () => {
	it("renders the logo with the translated alt text", () => {
		render(<RooHero />)

		expect(screen.getByAltText("Dory Code logo")).toHaveAttribute("src", "/dory-mark.svg")
	})
})
