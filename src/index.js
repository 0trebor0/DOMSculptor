/**
 * function to loadFeatures
 * @param {object} object - The object of which you want to add features
 * @returns {string} - returns ''
 */
function loadFeatures( e ){
    e.children = [];

    e.setAttribute = (name,value='')=>{

        return e.html.setAttribute(name, value);

    }

    e.removeAttribute = (name)=>{

        return e.html.removeAttribute(name);

    }

    e.getAttribute = (name)=>{

        return e.html.getAttribute(name);

    }

    e.hasAttribute = (name)=>{

        return e.html.hasAttribute(name);

    }

    e.addClass = (value)=>{

        return e.html.classList.add(value);

    }

    e.removeClass = (value)=>{

        return e.html.classList.remove(value);

    }

    e.containsClass = (value)=>{

        return e.html.classList.contains(value);

    }

    e.setText = ( text )=>{

        e.html.textContent = text;
    
    }

    e.setStyle = ( property, value)=>{
    
        e.html.style[property] = value;
    
    }

    e.hide = ()=>{
    
        return e.setStyle( 'display', 'none' );
    
    }

    e.appendChild = ( child )=>{
    
        return e.html.appendChild( child );
    
    }

    e.createChild = ( name,callback=null )=>{

        if( typeof callback !== 'function' ){
            callback = null;
        }
    
        return create( name,e,callback );
    
    }

    e.on = ( event, callback )=>{
    
        return e.html.addEventListener(event, callback);
    
    }

    e.off = ( event, callback )=>{
    
        return e.html.removeEventListener(event, callback);
    
    }
    return;
}
/**
 * function to search element
 * @param {value} string - The id or name of element
 * @returns {object} - returns {}
 */
function search( value ){

    let e = {};

    loadFeatures( e );

    e.html = document.querySelector( value );

    return e;

}
/**
 * function to search element
 * @param {value} string - The id or name of element
 * @returns {object} - returns []
 */
function searchAll( value ){

    return Array.from(document.querySelectorAll(value), element => {
        
        let e = { html: element };
        
        loadFeatures(e);
        
        return e;
    
    });

}
/**
 * function to  create dom element
 * @param {name} string - the name of the element
 * @param {parent} object - the dom, object of element
 * @param {callback} function -the callback function
 * @returns {object} - returns {}
 */
function create( name,parent=null,callback=null ){

    let e = {};
    
    e.html = document.createElement( name );
    
    loadFeatures( e );

    if( parent == null ){

        document.body.lastChild.appendChild( e.html );

    }else if( 'html' in parent ){

        parent.children.push( e );

        parent.html.appendChild( e.html );

    } else if( 'nodeType' in parent && parent.nodeType === 1 ){

        parent.appendChild( e.html );

    } else if( document.querySelector( parent ) ){

        document.querySelector( parent ).appendChild( e.html );

    }

    if( typeof callback == 'function' ){

        callback(e);

    }

    return e;

}