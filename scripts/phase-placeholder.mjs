const message = process.argv[2]

if (message) {
  console.error(`Unavailable: ${message}`)
  process.exitCode = 1
}
