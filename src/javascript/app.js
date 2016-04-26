Ext.define("TSEpicIterationReport", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    
    layout:'border',
    
    items: [
        {xtype:'container',itemId:'selector_box',region:'north'},
        {xtype:'container',itemId:'display_box', region:'center', layout:'fit'}
    ],

    integrationHeaders : {
        name : "TSEpicIterationReport"
    },

    launch: function() {
        this.down('#selector_box').add({
            xtype:'rallyiterationcombobox',
            listeners: { 
                scope: this,
                change: this._updateData
            }
        });
    },
    
    _updateData: function(cb) {
        var iteration = cb.getRecord();
        
        Deft.Chain.pipeline([
            function() { return this._getStoriesInIteration(iteration); },
            this._arrangeRecordsByProjectAndEpic,
            this._makeRows
        ],this).then({
            scope: this,
            success: function(rows) {
                this._makeGrid(rows);
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem Loading Data', msg);
            }
        });
    },
    
    _makeGrid: function(rows) {
        var container = this.down('#display_box');
        
        container.removeAll();
        
        var store = Ext.create('Rally.data.custom.Store',{
            data: rows
        });
        
        container.add({
            xtype:'rallygrid',
            store: store,
            columnCfgs: this._getColumns(),
            showRowActionsColumn: false
        });
    },
    
    _getColumns: function() {
        var columns = [];
        
        columns.push({ dataIndex:'ProjectName',  text:'Project' });
        
        columns.push({ dataIndex:'EpicOID', text:'Epic', flex: 1, renderer: function(value, meta, record) {
            if ( value == -1 ) { return ""; }
            return Ext.String.format("{0}: {1}", 
                record.get('Epic').FormattedID,
                record.get('Epic').Name
            );
        }});
        
        columns.push({dataIndex:'PlanEstimate', text:'Sum of Estimates'});
        columns.push({dataIndex:'c_ExtID01TPR', text:'ExtID: 01 - TPR'});
        
        return columns;
    },
    
    _makeRows: function(hash) {
        var rows = [];
        
        Ext.Object.each(hash, function(project_oid, project_set){
            var project = project_set.project;
            Ext.Object.each(project_set.records, function(epic_oid, epic_set){
                var epic = epic_set.epic;
                var plan_estimates = Ext.Array.map(epic_set.records, function(record){
                    var size = record.get('PlanEstimate') || 0;
                    return 1000 * size;
                });
                
                var row = {
                    Project: project,
                    ProjectName: project.Name,
                    Epic: epic,
                    EpicName: epic.Name,
                    EpicOID: epic_oid,
                    Records: epic_set.records,
                    PlanEstimate: Ext.Array.sum(plan_estimates) / 1000,
                    c_ExtID01TPR: epic.c_ExtID01TPR
                };
                
                rows.push(row);
            });
        });
        
        return rows;
    },
    
    _arrangeRecordsByProjectAndEpic: function(records) {
        var records_by_project = {};
        Ext.Array.each(records, function(record){
            var project = record.get('Project');
            var epic = { FormattedID:"", Name:"None", ObjectID:-1 };
            var feature = record.get('Feature');
            
            if ( !Ext.isEmpty(feature) && !Ext.isEmpty(feature.Parent) ) {
                epic = feature.Parent;
            }
            
            var project_oid = project.ObjectID;
            var epic_oid = epic.ObjectID;
            
            if ( Ext.isEmpty(records_by_project[project_oid]) ) {
                records_by_project[project_oid] = {
                    project: project,
                    records: {}
                };
            }
            
            if ( Ext.isEmpty( records_by_project[project_oid]['records'][epic_oid] )) {
                records_by_project[project_oid]['records'][epic_oid] = {
                    epic: epic,
                    records:[]
                };
            }
            
            records_by_project[project_oid]['records'][epic_oid].records.push(record);
        });
        
        return records_by_project;
    },
    
    _getStoriesInIteration: function(iteration) {
        var filters = [{property:'Iteration.Name',value:iteration.get('Name')}];
        
        var config = {
            model:'HierarchicalRequirement',
            fetch:['FormattedID','Name','PlanEstimate','Project','Feature','Parent','ObjectID','c_ExtID01TPR'],
            filters: filters,
            limit: Infinity
        };
        
        return this._loadWsapiRecords(config);
    },
      
    _loadWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID']
        };

        me.setLoading('Loading ' + config.model + '...');
        
        this.logger.log("Starting load:",config.model);
        Ext.create('Rally.data.wsapi.Store', Ext.Object.merge(default_config,config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
                
                me.setLoading(false);
            }
        });
        return deferred.promise;
    },

    _loadAStoreWithAPromise: function(model_name, model_fields){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        this.logger.log("Starting load:",model_name,model_fields);
          
        Ext.create('Rally.data.wsapi.Store', {
            model: model_name,
            fetch: model_fields
        }).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(this);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },
    
    _displayGrid: function(store,field_names){
        this.down('#display_box').add({
            xtype: 'rallygrid',
            store: store,
            columnCfgs: field_names
        });
    },
    
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    }
});
