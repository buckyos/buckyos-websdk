

//utils
// function get_zone_host_name(hostname:string) : string|null {
//     if (_this_zone_hostname != null) {
//         if (hostname.endsWith(_this_zone_hostname)) {
//             return _this_zone_hostname;
//         }
//     }

//     if (hostname.endsWith(".did")) {
//         let sub_hosts = hostname.split(".");
//         if(sub_hosts.length > 2) {
//             //appname.lzc.bns.did, return lzc.bns.did
//             let zone_id = sub_hosts[sub_hosts.length - 3];
//             return sub_hosts.slice(-2).join(".");

//         }
//     }

//     for (let bridge_hostname of _all_web3_bridges) {
//         if (hostname.endsWith(bridge_hostname)) {
//             //if *.lzc.web3.buckyos.io and bridge_hostname is web3.buckyos.io,return lzc.web3.buckyos.io
//             let prefix = hostname.substring(0, hostname.length - bridge_hostname.length -1);
//             let sub_hosts = prefix.split(".");
//             if (sub_hosts.length > 1) {
//                 return sub_hosts[sub_hosts.length - 1] + "." + bridge_hostname;
//             } else {
//                 return prefix + "." + bridge_hostname;
//             }
//         }
//     }

//     return null;
// }
