# DOMSculptor - Client Utility Function

	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Document</title>
		<script type="module" src="https://cdn.jsdelivr.net/npm/domsculptor/src/index.js"></script>
	</head>
	<style>
		body{
			margin: 0;
		}
	</style>
	<body>
		<script>
			class Test extends App{
				constructor(){
					super();
					this.navbar();
					this.content();
					this.footer();
				}
				navbar(){
					let nav = this.create('nav',document.body);
					nav.setStyle('display','flex');
					nav.setStyle('justify-content','center');

					let items = [
						{name:'Home',value:'./'},
						{name:'Register',value:'./'},
						{name:'Login',value:'./'},
						{name:'About',value:'./'},
					];
					items.forEach(item=>{
						let li = nav.createChild('li');
						li.setStyle('list-style','none');
						li.setStyle('padding','1%');
						let a = li.createChild('a');
						a.setText( item.name );
						a.setAttribute('href',item.value);
						a.setStyle('text-decoration','none');
					});
				}
				content(){
					let div = this.create('div',document.body);
					// div.setStyle('display','flex');
					// div.setStyle('width','100%');
					// div.setStyle('height','85%');

					let p = div.createChild('p');
					p.setText('TEXT');
				}
				footer(){
					let div = this.create('div',document.body);
					div.setStyle('display','flex');
					div.setStyle('justify-content','center');

					let p = div.createChild('p');
					p.setText('@Copyright Robert');
				}
			}
			window.onload = ()=>{
				let test = new Test();
			}
		</script>
	</body>
	</html>