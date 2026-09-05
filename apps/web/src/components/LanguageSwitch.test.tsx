import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { LanguageSwitch } from "./LanguageSwitch";

describe("LanguageSwitch", () => {
  it("renders English and Chinese options", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitch />
      </I18nextProvider>,
    );
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("button", { name: "中文" })).toHaveClass("active");
  });
});
