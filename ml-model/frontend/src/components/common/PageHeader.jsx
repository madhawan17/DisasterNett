import React from 'react';

export default function PageHeader({ title, subtitle, icon: Icon, children }) {
  return (
    <div className="bg-white border-b border-gray-100 shadow-sm px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 flex-shrink-0">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
          {Icon && <Icon className="w-6 h-6 text-green-500" />}
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-gray-500 font-medium mt-1">
            {subtitle}
          </p>
        )}
      </div>
      
      {children && (
        <div className="flex gap-3 w-full sm:w-auto">
          {children}
        </div>
      )}
    </div>
  );
}
