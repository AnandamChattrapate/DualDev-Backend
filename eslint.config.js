// ESLint reads your code and flags suspicious patterns — undeclared variables, 
// unreachable code, etc. — without running anything. 
// It's static analysis, the opposite of a test (which actually executes code and checks output)

// ESLint → Checks JavaScript code for errors and bad practices.
// @eslint/js → Recommended ESLint rules.
// globals → Defines built-in global variables.
// rules → Customize ESLint behavior.
// ignores → Files/folders ESLint should skip.
import js from "@eslint/js"
import globals from "globals"

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
  { ignores: ["node_modules/**", "package-lock.json"] },
]