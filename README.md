# DOMSculptor - Client Side Library

	let div = create('div',document.body);

	let video = div.createChild('video');
	video.setAttribute('autoplay');
	video.setAttribute('controls');
	video.setAttribute('src','https://example/example.mp4');
	video.setStyle('width','100%');
	video.setStyle('height','100%');

	div return {
		html DOM,
		addClass(value)=>{…},
		appendChild( child )=>{…},
		children[{…}],
		containsClass( value )=>{…},
		getAttribute(name)=> {…},
		hasAttribute(name)=> {…},
		hide()=> {…},
		off( event, callback )=> {…},
		on( event, callback )=> {…},
		removeAttribute(name)=> {…},
		removeClass(value)=> {…},
		setAttribute(name,value)=> {…},
		setStyle( property, value)=> {…},
		setText( text )=> {…}
	}