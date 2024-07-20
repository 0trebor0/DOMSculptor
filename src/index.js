class DomSculptor {

    create(name, parent = null, callback = null) {

        let ele = {};

        ele.html = document.createElement(name);

        ele.children = [];

        ele.attribute = {
            set:(name, value = '')=>{
                ele.html.setAttribute(name, value);
                return ele;
            },
            remove:( name )=>{
                ele.html.removeAttribute(name)
                return ele;
            },
            get:( name )=>{
                ele.html.getAttribute(name);
                return ele;
            },
            has:( name )=>{
                ele.html.hasAttribute(name);
                return ele;
            }
        };

        

        ele.setText = (text) => { ele.html.textContent = text; }

        ele.setStyle = (property, value) => { 
            ele.html.style[property] = value;
            return ele;
        }

        ele.hide = () => ele.setStyle('display', 'none');

        ele.child = {
            append:( child )=>{
                ele.html.appendChild(child);
                return ele;
            },
            create:( name, callback = null )=>{
                return this.create(name, ele, callback);
            }
        };

        ele.class = {
            add: (value) => {
                ele.html.classList.add(value);
                return ele;
            },
            remove: (value) => {
                ele.html.classList.remove(value);
                return ele;
            },
            contains: (value) => {
                return ele.html.classList.contains(value);
            }
        };

        ele.on = (event, callback) => ele.html.addEventListener(event, callback);

        ele.off = (event, callback) => ele.html.removeEventListener(event, callback);

        if (parent == null) {

            document.body.lastChild.appendChild(ele.html);

        } else if ('html' in parent) {

            parent.children.push(ele);

            parent.html.appendChild(ele.html);

        } else if ('nodeType' in parent && parent.nodeType === 1) {

            parent.appendChild(ele.html);

        } else if (document.querySelector(parent)) {

            document.querySelector(parent).appendChild(ele.html);

        }

        if (typeof callback == 'function') {

            callback(ele);

        }

        return ele;

    }
    jsontohtml( object ){
        if( typeof object !== 'object' ){
            throw new Error('Parameter Not valid JSON Object');
            return;
        }
        if( !("type" in object) ){
            throw new Error('Must Specify Element Type ');
            return;
        }
        if( !("parent" in object) ){
            throw new Error('Must Specify The Parent Element ');
            return;
        }
        let element = this.create( object.type, object.parent );
        if( object.attributes && typeof object.attributes == 'object' ){
            object.attributes.forEach(attr => element.attribute.set(attr.type, attr.content));
        }
        if( object.class && Array.isArray( object.class) ){
            object.class.forEach(cls => element.class.add(cls));
        }
        if( object.onclick && typeof object.onclick == 'function' ){
            element.on( 'click', object.onclick );
        }
        if( ("oncreate" in object && typeof object.oncreate == 'function') ){
            object.oncreate(element);
        }
        if( object.content ){
            if(typeof object.content == 'string' ){
                element.setText(object.content);
            } else if(Array.isArray(object.content)) {
                object.content.forEach( item=>{
                    if( typeof item == 'object' ){
                        item.parent = element;
                        this.jsontohtml( item );
                    } else if( typeof item == 'string' ){
                        element.setText( item );
                    }
                } );
            }
        }
        return element;
    }

}
