# DomSculptor: Simplify Your DOM Manipulation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://GitHub.com/your-username/your-repo/graphs/commit-activity)
[![GitHub Stars](https://img.shields.io/github/stars/your-username/your-repo?style=social)](https://github.com/your-username/your-repo/stargazers)

`DomSculptor` is a lightweight JavaScript class designed to make Document Object Model (DOM) manipulation more organized, readable, and efficient. It provides a streamlined API for creating, modifying, and managing HTML elements.

## Getting Started

### Installation

No installation is required!  Include the `DomSculptor` class definition in your JavaScript code.

**Option 1: Copy and Paste**

Copy the entire `DomSculptor` class code and paste it directly into your main JavaScript file or within a `<script>` tag in your HTML.

**Option 2:  CDN (Alternative)**

You can also include DomSculptor via CDN.  Add this to your `<head>`:

```html
<script src="https://cdn.jsdelivr.net/gh/0trebor0/DOMSculptor@master/src/index.js"></script>
Important: If using the CDN, ensure your main script comes after this <script> tag.Example HTML StructureHere's a basic HTML example showing how to include DomSculptor (using the CDN method):<!DOCTYPE html>
<html>
<head>
    <title>My Webpage</title>
    <script src="[https://cdn.jsdelivr.net/gh/0trebor0/DOMSculptor@master/src/index.js](https://cdn.jsdelivr.net/gh/0trebor0/DOMSculptor@master/src/index.js)"></script>
    <script src="script.js"></script> <--- Your main script file
</head>
<body>
    <div id="content-area"></div>
    <script>
        // Your main JavaScript code (script.js)
        const sculptor = new DomSculptor(); 
        // ... your DomSculptor code here
    </script>
</body>
</html>
UsageCreate a DomSculptor Instance:const sculptor = new DomSculptor();
Create New HTML Elements with create():// Create a <div> and append it to the <body>
const myDiv = sculptor.create('div');
document.body.appendChild(myDiv.html); // Don't forget to append the actual HTML element

// Create a <p> and append it to the div
const myParagraph = sculptor.create('p', myDiv).setText('This is some text.');

// Create a <span> and append it to the <body>
const mySpan = sculptor.create('span', document.body).setText('A simple span.');
sculptor.create('tagname', parent, callback):'tagname': The HTML tag to create.parent (optional): The parent element (DOM node, DomSculptor element, or CSS selector). Defaults to <body>.callback (optional): A function executed after creation, receiving the DomSculptor element object.Modify Element Content with setText():const heading = sculptor.create('h1', document.body).setText('My Awesome Title');
Manage Attributes with attribute:const image = sculptor.create('img', document.body)
    .attribute.set('src', 'image.jpg')
    .attribute.set('alt', 'An image')
    .attribute.set({ width: '200', height: '150' })
    .attribute.remove('width');

const altText = image.attribute.get('alt');
const hasWidth = image.attribute.has('width');
Apply Styles with setStyle():const button = sculptor.create('button', document.body)
    .setText('Click Me')
    .setStyle('background-color', 'lightblue')
    .setStyle({ padding: '10px 20px', border: 'none', cursor: 'pointer' });
Show/Hide Elements with hide() and show():const message = sculptor.create('div', document.body).setText('Hidden Message').hide();
// ... later ...
message.show();
Manage Child Elements with child:const myList = sculptor.create('ul', document.body)
    .child.append('First Item (text)')
    .child.create('li').setText('Second Item')
    .child.append(sculptor.create('li').setText('Third Item'));
Work with CSS Classes with class:const specialDiv = sculptor.create('div', document.body).setText('Special')
    .class.add('important', 'highlight')
    .class.remove('highlight');

const isImportant = specialDiv.class.contains('important');
Handle Events with on() and off():const clickableButton = sculptor.create('button', document.body)
    .setText('Clickable')
    .on('click', () => alert('Button was clicked!'))
    .on({
        mouseover: () => console.log('Mouse over'),
        mouseout: () => console.log('Mouse out')
    });

const alertFunction = () => alert('This alert will be removed.');
const removableButton = sculptor.create('button', document.body).setText('Removable Alert');
removableButton.on('click', alertFunction).off('click', alertFunction);

const anotherButton = sculptor.create('button', document.body).setText('Multiple Clicks');
const clickHandler1 = () => console.log('Click 1');
const clickHandler2 = () => console.log('Click 2');
anotherButton.on('click', clickHandler1).on('click', clickHandler2).off('click');
Remove Elements with remove():const removableDiv = sculptor.create('div', document.body).setText('I will be removed.');
// ... later ...
removableDiv.remove();
Build Complex Structures with jsontohtml():const complexStructure = sculptor.jsontohtml({
    type: 'div',
    parent: document.getElementById('content-area'),
    attributes: { id: 'main-container' },
    styles: { border: '1px solid #ccc', padding: '15px' },
    children: [
        { type: 'h2', text: 'Section Title' },
        { type: 'p', text: 'Some descriptive text.' },
        {
            type: 'ul',
            classes: ['item-list'],
            children: [
                { type: 'li', text: 'Item One', classes: ['list-item'] },
                { type: 'li', text: 'Item Two' }
            ]
        },
        {
            type: 'button',
            text: 'Click Me',
            events: { click: () => alert('Button clicked!') }
        }
    ]
});
ContributingContributions are welcome! Feel free to submit pull requests with bug fixes or enhancements. Please follow standard GitHub practices.LicenseThis project is licensed under the MIT License - see the LICENSE file for details.AcknowledgmentsInspired by the need for cleaner DOM manipulation in vanilla JavaScript.Thanks to the open-source community for their valuable insights