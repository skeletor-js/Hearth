import { expect, test } from 'bun:test'
import { parseUnifiedDiff } from './git-diff.js'

test('parses a modified file with adds, dels, and context', () => {
  const diff = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,4 @@ export function foo() {
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 const d = 5
`
  const [f] = parseUnifiedDiff(diff)
  expect(f.file).toBe('src/foo.ts')
  expect(f.tag).toBe('modified')
  expect(f.add).toBe(2)
  expect(f.del).toBe(1)

  // hunk header captured, line numbers tracked per side.
  const hunk = f.rows.find((r) => r.t === 'hunk')!
  expect(hunk.code).toBe('export function foo() {')
  const add = f.rows.filter((r) => r.t === 'add')
  expect(add.map((r) => r.code)).toEqual(['const b = 3', 'const c = 4'])
  expect(add[0].ln).toBe(2) // new-side line number
  const del = f.rows.find((r) => r.t === 'del')!
  expect(del.code).toBe('const b = 2')
  expect(del.ln).toBe(2) // old-side line number
  const ctx = f.rows.filter((r) => r.t === 'ctx')
  expect(ctx[0].ln).toBe(1)
  expect(ctx[1].ln).toBe(4) // after 2 adds, new-side advanced
})

test('parses a new file as all-additions', () => {
  const diff = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`
  const [f] = parseUnifiedDiff(diff)
  expect(f.file).toBe('new.txt')
  expect(f.tag).toBe('new')
  expect(f.add).toBe(2)
  expect(f.del).toBe(0)
})

test('parses a deleted file and names it from the old side', () => {
  const diff = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`
  const [f] = parseUnifiedDiff(diff)
  expect(f.file).toBe('gone.txt')
  expect(f.tag).toBe('deleted')
  expect(f.del).toBe(1)
})

test('parses a rename with its old path', () => {
  const diff = `diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
index 5555555..6666666 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,1 +1,1 @@
-was here
+is here
`
  const [f] = parseUnifiedDiff(diff)
  expect(f.tag).toBe('renamed')
  expect(f.oldPath).toBe('old/name.ts')
  expect(f.file).toBe('new/name.ts')
})

test('parses multiple files in one diff', () => {
  const diff = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-a
+b
diff --git a/c.ts b/c.ts
index 3..4 100644
--- a/c.ts
+++ b/c.ts
@@ -1 +1 @@
-c
+d
`
  const files = parseUnifiedDiff(diff)
  expect(files.map((f) => f.file)).toEqual(['a.ts', 'c.ts'])
})

test('empty diff yields no files', () => {
  expect(parseUnifiedDiff('')).toEqual([])
})

test('ignores "no newline at end of file" markers', () => {
  const diff = `diff --git a/x b/x
index 1..2 100644
--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`
  const [f] = parseUnifiedDiff(diff)
  expect(f.add).toBe(1)
  expect(f.del).toBe(1)
  expect(f.rows.some((r) => r.code.startsWith('No newline'))).toBe(false)
})
