import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const testSuitePath = searchParams.get("path")

  if (!testSuitePath) {
    return NextResponse.json({ error: "Path parameter is required" }, { status: 400 })
  }

  try {
    // Check if the directory exists
    const stats = await fs.stat(testSuitePath)
    if (!stats.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 })
    }

    // Read all JSON files from the directory
    const testSuites = await loadTestSuitesFromDirectory(testSuitePath)

    return NextResponse.json(testSuites)
  } catch (error) {
    console.error("Error loading test suites:", error)
    return NextResponse.json({ error: "Failed to load test suites from the specified path" }, { status: 500 })
  }
}

async function loadTestSuitesFromDirectory(dirPath: string): Promise<any[]> {
  const testSuites: any[] = []
  const processedPaths = new Set<string>() // Track processed file paths to avoid duplicates

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // Recursively load from subdirectories
        const subSuites = await loadTestSuitesFromDirectory(fullPath)
        testSuites.push(...subSuites)
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        // Skip if we've already processed this file path
        if (processedPaths.has(fullPath)) {
          continue
        }
        processedPaths.add(fullPath)

        try {
          const fileContent = await fs.readFile(fullPath, "utf-8")
          const testSuite = JSON.parse(fileContent)

          // Generate a deterministic ID based on file path and suite name
          const pathHash = Buffer.from(fullPath)
            .toString("base64")
            .replace(/[^a-zA-Z0-9]/g, "")
            .substring(0, 8)
          const suiteName = testSuite.suiteName ? testSuite.suiteName.replace(/[^a-zA-Z0-9]/g, "_") : "unnamed"
          const uniqueId = `${suiteName}_${pathHash}`

          // Add metadata
          testSuite.id = uniqueId
          testSuite.filePath = fullPath
          testSuite.fileName = entry.name
          testSuite.lastModified = (await fs.stat(fullPath)).mtime

          // Validate basic structure
          if (testSuite.suiteName && testSuite.testCases) {
            testSuites.push(testSuite)
          } else {
            console.warn(`Invalid test suite structure in file: ${fullPath}`)
          }
        } catch (parseError) {
          console.error(`Error parsing JSON file ${fullPath}:`, parseError)
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error)
  }

  // Remove any potential duplicates based on file path
  const uniqueSuites = testSuites.filter(
    (suite, index, self) => index === self.findIndex((s) => s.filePath === suite.filePath),
  )

  return uniqueSuites
}

function generateIdFromPath(filePath: string): string {
  // Generate a consistent ID based on the file path
  return Buffer.from(filePath)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .substring(0, 16)
}

export async function POST(request: NextRequest) {
  try {
    const { testSuite, filePath } = await request.json()

    if (!filePath) {
      return NextResponse.json({ error: "File path is required" }, { status: 400 })
    }

    // Ensure the directory exists
    const dirPath = path.dirname(filePath)
    try {
      await fs.mkdir(dirPath, { recursive: true })
    } catch (error) {
      console.error("Error creating directory:", error)
      return NextResponse.json({ error: "Failed to create directory" }, { status: 500 })
    }

    // Check if file already exists
    let fileExists = false
    try {
      await fs.access(filePath)
      fileExists = true
    } catch {
      // File doesn't exist, which is fine for new files
    }

    // Write the test suite to the file
    await fs.writeFile(filePath, JSON.stringify(testSuite, null, 2), "utf-8")

    return NextResponse.json({
      success: true,
      message: fileExists ? "Test suite updated successfully" : "Test suite created successfully",
      filePath: filePath,
    })
  } catch (error) {
    console.error("Error saving test suite:", error)
    return NextResponse.json({ error: "Failed to save test suite" }, { status: 500 })
  }
}
