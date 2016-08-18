/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 * @flow
 */

import React, {
  Component,
  PropTypes
} from 'react';

import {
  AppRegistry,
  StyleSheet,
  Text,
  View,
  TextInput,
  Image,
  AsyncStorage,
  TouchableOpacity,
  TouchableHighlight,
  Navigator,
  ListView,
  WebView,
  RefreshControl,
  PushNotificationIOS,
  Linking
} from 'react-native';

import Moment from 'moment';
import SafariView from 'react-native-safari-view';
import FetchBlob from 'react-native-fetch-blob';
import SiteRow from './lib/components/site/row';
import RSAKeyPair from 'keypair';
import DeviceInfo from 'react-native-device-info';
import randomBytes from 'react-native-randombytes';
import JSEncrypt from './lib/jsencrypt';

class SiteManager {

  constructor() {
    this._subscribers = [];
    this.sites = [];
    this.load();
    this.ensureRSAKeys();
  }

  add(site) {
    this.sites.push(site);
    this.save();
    this._onChange();
  }

  remove(site) {
    let index = this.sites.indexOf(site);
    if (index >= 0) {
      this.sites.splice(index,1);
      this.save();
      this._onChange()
    }
  }

  subscribe(callback) {
    this._subscribers.push(callback);
  }

  unsubscribe(callback) {
    var pos = this._subscribers.indexOf(callback);
    if (pos >= -1) {
      this._subscribers = this._subscribers.splice(pos,1);
    }
  }

  save() {
    AsyncStorage.setItem('@Discourse.sites', JSON.stringify(this.sites));

    PushNotificationIOS.checkPermissions(p => {
      if (p.badge) {
        PushNotificationIOS.setApplicationIconBadgeNumber(this.totalUnread());
      }
    });
  }

  ensureRSAKeys() {
    AsyncStorage.getItem('@Discourse.rsaKeys').then((json) => {
      if (json) {
        this.rsaKeys = JSON.parse(json);
      } else {
        this.rsaKeys = RSAKeyPair();
        AsyncStorage.setItem('@Discourse.rsaKeys', JSON.stringify(this.rsaKeys));
      }
    });
  }

  load() {
    AsyncStorage.getItem('@Discourse.sites').then((json) => {
      if (json) {
        this.sites = JSON.parse(json).map(obj=>new Site(obj));
        this._onChange()
      }
    });
  }

  totalUnread() {
    let count = 0;
    this.sites.forEach((site)=>{
      if (site.authToken) {
        count += (site.unreadNotifications || 0) + (site.unreadPrivateMessages || 0);
      }
    });
    return count;
  }

  refreshSites() {
    let sites = this.sites.slice(0);

    return new Promise((resolve,reject)=>{
      if (sites.length === 0) {
        resolve(false);
        return;
      }

      let site = sites.pop();
      let somethingChanged = false;

      let processSite = (site) => {
        site.refreshNotificationCounts().then((changed) => {
          somethingChanged = somethingChanged || changed;
          let s = sites.pop();
          if (s) { processSite(s); }
          else {
            if (somethingChanged) {
              this.save();
            }
            resolve(somethingChanged);
          }
        });
      };

      processSite(site);
    });
  }


  serializeParams(obj) {

    return Object.keys(obj)
                 .map(k => `${encodeURIComponent(k)}=${encodeURIComponent([obj[k]])}`)
                .join("&");
  }

  getClientId() {
    return new Promise(resolve=>{
      if (this.clientId) {
        resolve(this.clientId);
      } else {
        randomBytes(32, (err, bytes) => {
          this.clientId = bytes.toString('hex');
          resolve(this.clientId);
        });
      }
    });
  }

  generateNonce(site) {
    return new Promise(resolve=>{
      randomBytes(16, (err, bytes) => {
        this._nonce = bytes.toString('hex');
        this._nonceSite = site;
        resolve(this._nonce);
      });
    });
  }

  handleAuthPayload(payload) {
    let crypt = new JSEncrypt();

    crypt.setKey(this.rsaKeys.private);
    let decrypted = JSON.parse(crypt.decrypt(payload));

    if (decrypted.nonce !== this._nonce) {
      alert("We were not expecting this reply, please try again!");
      return;
    }

    this._nonceSite.authToken = decrypted.key;
    this._nonceSite.refreshNotificationCounts()
        .then(()=>{
          this.save();
          this._onChange();
        });

  }

  generateAuthURL(site) {

    let clientId;

    return this.getClientId()
      .then(cid => {
        clientId = cid;
        return this.generateNonce(site);
      })
      .then(nonce => {
         let params = {
          access: 'rp',
          client_id: clientId,
          nonce: nonce,
          push_url: 'https://api.discourse.org/api/ios_notify',
          auth_redirect: 'discourse://auth_redirect',
          application_name: "Discourse - " + DeviceInfo.getDeviceName(),
          public_key: this.rsaKeys.public
        };

        return `${site.url}/user-api-key/new?${this.serializeParams(params)}`;
      });

  }

  _onChange() {
    this._subscribers.forEach((sub) => sub());
  }
}

class Site {
  static FIELDS = ['authToken', 'title', 'description', 'icon', 'url', 'unreadNotifications', 'unreadPrivateMessages'];

  static fromTerm(term) {
    let withProtocol = [];
    let url = "";

    term = term.trim();
    while (term.endsWith("/")) {
      term = term.slice(0, term.length-1);
    }

    if (!term.match(/^https?:\/\//)){
      url = "http://" + term;
    } else {
      url = term;
    }

    return Site.fromURL(url, term);
  }

  static fromURL(url, term) {


    let req = new Request(url + "/user-api-key/new", {
      method: 'HEAD'
    });

    return fetch(req)
      .then((r)=>{
        if (r.status !== 200) {
          alert("Sorry, " + term + " does not support mobile APIs, have owner upgrade Discourse to latest!")
          return;
        }

        // correct url in case we had a redirect
        let split = r.url.split("/")
        url = split[0] + "//" + split[2];

        return fetch(url + "/site/basic-info.json")
                 .then(r => r.json());

      })
      .then(info=>{
        return new Site({
          url: url,
          title: info.title,
          description: info.description,
          icon: info.apple_touch_icon_url
        });
      })
      .catch(e=>{
        alert(term + " was not found!")
      });
  }


  constructor(props) {
    if(props) {
      Site.FIELDS.forEach(prop=>{this[prop]=props[prop];});
    }
  }

  jsonApi(path) {
    return fetch(this.url + path, {
      method: 'GET',
      headers: {
        'User-Api-Key': this.authToken,
        'Content-Type': 'application/json'
      },
      mode: 'no-cors'
    }).then(r => r.json())
  }

  refreshNotificationCounts(){
    return new Promise((resolve,reject) => {

      if(!this.authToken) { resolve(false);  return;}

      this.jsonApi("/session/current.json")
         .then(json =>{
           currentUser = json.current_user;

           let changed = false;
           if (this.unreadNotifications !== currentUser.unread_notifications) {
             this.unreadNotifications = currentUser.unread_notifications;
             changed = true;
           }

           if (this.unreadPrivateMessages !== currentUser.unread_private_messages) {
             this.unreadPrivateMessages = currentUser.unread_private_messages;
             changed = true;
           }

           resolve(changed);

          }).catch(e=>{
           console.warn(e);
           resolve(false);
         });
    });
  }

  toJSON(){
    let obj = {};
    Site.FIELDS.forEach(prop=>{obj[prop]=this[prop];});
    return obj;
  }

}

class DiscourseMobile extends Component {

  constructor(props) {
    super(props);
    this._siteManager = new SiteManager();

    this._handleOpenUrl = (event) => {
      let split = event.url.split("payload=");
      if (split.length === 2) {
        this._siteManager.handleAuthPayload(decodeURIComponent(split[1]));
      }
    }
  }

  componentDidMount() {
    Linking.addEventListener('url', this._handleOpenUrl);
  }

  componentWillUnmount() {
    Linking.removeEventListener('url', this._handleOpenUrl);
  }

  openUrl(navigator, site) {
    if (site.authToken) {
      SafariView.show({url: site.url});
      return;
    }

    this._siteManager
      .generateAuthURL(site)
      .then(url => {
        Linking.openURL(url);
      });
  }

  render() {
    PushNotificationIOS.requestPermissions({"alert": true, "badge": true});
    return (
      <HomePage siteManager={this._siteManager}
                onVisitSite={(site)=> this.openUrl(navigator, site)} />

    );
  }
}

class HomePage extends Component {
  static propTypes = {
    onVisitSite: PropTypes.func.isRequired,
    siteManager: PropTypes.object.isRequired,
  }

  constructor(props) {
    super(props);


    this._dataSource = new ListView.DataSource({
      rowHasChanged: (r1, r2) => r1.toJSON() !== r2.toJSON()
    });
    this._dataSource = this._dataSource.cloneWithRows(this.props.siteManager.sites);

    this.state = {
      dataSource: this._dataSource,
      isRefreshing: false,
      refreshMessage: ""
    }

    this._onChangeSites = () => this.onChangeSites();
    this.props.siteManager.subscribe(this._onChangeSites);
  }

  componentDidMount() {
    this.props.siteManager.refreshSites()
      .then(()=>{
        this.setState({
          refreshMessage: "Last updated: " + Moment().format("LT")
        })
      });
  }

  componentWillUnmount() {
    this.props.siteManager.unsubscribe(this._onChangeSites);
  }

  onChangeSites() {
    this._dataSource = this._dataSource.cloneWithRows(this.props.siteManager.sites);
    this.setState({
      dataSource: this._dataSource
    })
  }


  doSearch(term) {
    Site.fromTerm(term)
      .then(site => {
        if (site) {
          this.props.siteManager.add(site);
        }
      });
  }

  _onRefresh() {
    this.setState({isRefreshing: true});
    this.props.siteManager.refreshSites()
      .then(()=>{
      this.setState({
        isRefreshing: false,
        refreshMessage: "Last updated: " + Moment().format("LT")
      })
    });
  }

  render() {
    return (
      <View style={styles.container}>
        <TextInput
          style={styles.term}
          placeholder="Add Site"
          returnKeyType="search"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(search) => this.setState({search})}
          onSubmitEditing={()=>this.doSearch(this.state.search)}

        />
        <ListView
          dataSource={this.state.dataSource}
          enableEmptySections={true}
          styles={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={this.state.isRefreshing}
              onRefresh={()=>this._onRefresh()}
              title="Loading..."
            />
          }
          renderRow={(site) =>
            <SiteRow site={site} onClick={()=>this.props.onVisitSite(site)} onDelete={()=>this.props.siteManager.remove(site)}/>
          }
        />
        <Text style={styles.statusLine}>{this.state.refreshMessage}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  term: {
    height: 40,
    paddingLeft: 10,
    marginBottom: 20
  },
  list: {
    flex: 10
  },
  container: {
    flex: 1,
    padding: 10,
    paddingTop: 30,
    justifyContent: 'flex-start',
    backgroundColor: '#FFFAFF',
  },
  statusLine: {
    color: "#777",
    fontSize: 10
  }
});

AppRegistry.registerComponent('DiscourseMobile', () => DiscourseMobile);
