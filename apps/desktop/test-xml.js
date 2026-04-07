const { XMLParser } = require('fast-xml-parser');
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: false,
});
console.log(JSON.stringify(xmlParser.parse('<p:sp><p:txBody><a:p><a:r><a:t xml:space="preserve"> Hello World </a:t></a:r></a:p></p:txBody></p:sp>')));
