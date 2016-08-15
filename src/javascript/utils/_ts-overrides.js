Ext.override(Rally.ui.picker.MultiObjectPicker,{
    createStore: function () {
        var deferred = Ext.create('Deft.Deferred');
        
        var storeConfig = Ext.merge({
            model: this.modelType,
            filters: [{property:'EndDate',operator:'<',value:Rally.util.DateTime.toIsoString(new Date())}]
        }, this.storeConfig);
        
        storeConfig.remoteGroup  = true;
        storeConfig.remoteSort   = true;
        storeConfig.remoteFilter = true;
        

        var interim_store = Ext.create('Rally.data.wsapi.Store',storeConfig);
        
        interim_store.load({ 
            scope: this,
            callback: function(records, operation,success){
                this.store = Ext.create('Rally.data.custom.Store',{
                    data: records,
                    sorters: [{property:'EndDate',direction:'DESC'}]
                });
                
                this.store.load({
                    scope: this,
                    callback: function(records, operation,success){
                        this.relayEvents(this.store, ['datachanged']);
                        
                        deferred.resolve(this.store);                        
                    }
                });

            }
        })

        return deferred.promise;
    }
});