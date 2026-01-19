
const regex = /^([1-3]?\s*[A-Za-z]+(?:[A-Za-z\s]*))\s+(\d+)(?::\s*(\d+)(?:\s*-\s*(\d+))?)?(?:\s+([A-Za-z0-9]+))?$/i;

const inputs = [
  "Matthew 3:1",
  "Matthew 3:1-10",
  "Matthew 3:1-10 NKJV",
  "1 John 1:9",
  "1 John 1:9-10"
];

inputs.forEach(input => {
  const match = input.trim().match(regex);
  console.log(`Input: "${input}"`);
  if (match) {
    console.log("MATCHED!");
    // Groups: 0=full, 1=book, 2=chapter, 3=start, 4=end, 5=version
    console.log("Book:", match[1]);
    console.log("Chapter:", match[2]);
    console.log("Start:", match[3]);
    console.log("End:", match[4]);
    console.log("Version:", match[5]);
  } else {
    console.log("FAILED TO MATCH");
  }
  console.log("---");
});
