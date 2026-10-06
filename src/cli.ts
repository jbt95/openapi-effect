#!/usr/bin/env node
import { runCli } from "./cli/program.js"

process.exitCode = await runCli(process.argv.slice(2))
